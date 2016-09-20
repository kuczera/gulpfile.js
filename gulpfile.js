var gulp        = require('gulp'),
    pkg         = require('./package.json'),
    plug        = require('gulp-load-plugins')(),
    through     = require('through2'),
    async       = require('async'),
    clc         = require('cli-color'),
    _           = require('lodash'),
    slug        = require('slug'),

    path        = require('path'),
    request     = require('request'),

    moment      = require('moment'),
    
    settings    = require('./settings'),

    xml2js      = require('xml2js').parseString,

    neo4j       = require("seraph")(settings.neo4j),

    src = path.resolve(__dirname, settings.paths.src),
    dest = path.resolve(__dirname, settings.paths.dest);
  
// 1. harvest-collections task
// get the COLLECTION regestae xml files from the server
// Please check `settings.collections` for the url list and
// `settings.paths.collections` for the output
gulp.task('harvest-collections', function(done){
  var q = async.queue(function(url, nextUrl){
    var collection, stream;
    
    // get regesta collection name from url
    collection = url.match(/\/([\d\-]+)\//)[1];

    // create xml files named after the collection id
    stream = plug.download(url)
      .pipe(plug.rename({
        basename: collection,
        extname: ".xml"
      }))
      .pipe(gulp.dest(settings.paths.collections))
      
    stream.on('finish', nextUrl);
  }, 2);
  q.push(settings.collections);
  q.drain = done;
});


// 2. harvest-regestae task
// download the regestae xml files from the server
gulp.task('harvest-regestae', function(){
  return gulp.src(path.join(settings.paths.collections, '*.xml'))
    .pipe(function(){
      return through.obj(function (file, encoding, done) {
        if(file.isNull())
          return done(null, file);
        console.log(clc.blackBright('  parsing:', clc.cyanBright(file.path)));

        xml2js(file.contents, function(err, result){
          if(err)
            throw err;

          console.log(clc.blackBright('   parsed:', clc.cyanBright(file.path)));
          
          var regestae = _.get(result, 'collection');

          var q = async.queue(function(regesta, nextRegesta){
            stream = plug.download(regesta.href)
              .pipe(plug.rename({
                dirname: regestae.$.id,
                basename: regesta.id,
                extname: ".xml"
              }))
              .pipe(gulp.dest(settings.paths.regestae))
              
            stream.on('finish', nextRegesta);
          }, 4);

          q.push(_.map(regestae.resource, '$'));
          q.drain = function(){
            done(null, file);
          }
        })
      });
    }())
    .pipe(plug.size({
      title: 'harvest-regestae'
    }));
});


// 3. distill-regestae task
// parse the regesta files
gulp.task('distill-regestae', function() {
  console.log('src:  ', src)
  console.log('dest: ', dest)

  return gulp.src(src)
    .pipe(function(){
      return through.obj(function (file, encoding, done) {
        if(file.isNull())
          return done(null, file);
        console.log(file.path)
        var neo4jRegestaId,
            
            uniqueRegestaId = file.path.match(/\/([\d\-_a-zA-Z]+)\.xml$/)[1],

            node          = {
              slug      : uniqueRegestaId,
              languages : ['de'],
              type      : 'regesta',
              mimetype  : 'gif/image'
            },
            
            graph           = {
              nodes: [],
              links: []
            };
            

        console.log(clc.blackBright('  id:'),uniqueRegestaId);
          
        // parse xml file
        xml2js(file.contents, function(err, result){
          if(err) {
            console.log(err);
            file.contents = new Buffer(JSON.stringify({error:'xml not valid'}));
            done(null, file);
          }
          
          // parse object tree with lodash
          _({
            identifier: 'cei.charter[0].chDesc[0].head[0].idno[0]',
            title_de: 'cei.teiHeader[0].fileDesc[0].titleStmt[0].title[0]',
            name: 'cei.teiHeader[0].fileDesc[0].titleStmt[0].title[0]',
            caption_de: 'cei.charter[0].chDesc[0].abstract[0].p[0]',
            date: 'cei.charter[0].chDesc[0].head[0].issued[0].issueDate[0].p[0].dateRange[0]', // data handling, automatic parsing
            source: 'cei.charter[0].chDesc[0].div[0].list[0].item[0].ref[0]._', // is there more than one image? E.g. one per page?
            // url: 'cei.teiHeader[0].fileDesc[0].sourceDesc[0].bibl[0].idno[0]._',
            // volume: 'cei.teiHeader[0].fileDesc[0].sourceDesc[0].bibl[0].idno[2]._',
            // volume_alt: 'cei.teiHeader[0].fileDesc[0].sourceDesc[0].bibl[0].idno[5]._',
            idno: 'cei.teiHeader[0].fileDesc[0].sourceDesc[0].bibl[0].idno',
          }).each(function(d, i){
            var value = _.get(result, d);
            // console.log(clc.cyanBright(' ',i),clc.blackBright('=>'), value);
            if(i == 'caption_de' && typeof value == 'object'){
              value = _.get(value, '_');
            }

            if(i == 'date' && value){
              node.date = value._;
              var startDate = moment.utc(value.$.from),
                  endDate = moment.utc(value.$.to);

              if(startDate.isValid() && endDate.isValid()){
                startDate.startOf('day');
                endDate.endOf('day');

                node.start_date = startDate.toISOString(),
                node.start_time = startDate.format('X'),
                node.end_date   = endDate.toISOString(),
                node.end_time   = endDate.format('X');
                // console.log(node)
              }
            } else if(value) {
              node[i] = value
            }
          });

          if(node.idno){
            node.url = _.get(_.find(node.idno, {'$': { n: 'uri' }}), '_');
            node.volume = _.get(_.find(node.idno, {'$': { n: 'volume' }}), '_');
          }

          if(!node.url) {
            // console.log(result)
            console.log(clc.redBright('  uri not found:'), file.path);
            file.contents = new Buffer(JSON.stringify({error: 'uri not found, xml is invalid'}));
            done(null, file);
            return;
          }

          console.log('--uri', node.url)
          

          // get the "nummer" for neo4j connection
          neo4jRegestaId = '#' + [
            +(node.volume),
            node.identifier.match(/[\da-zA-Z]+$/)[0]
            // @deprecated: 
            // node.url.match(/[_-]([\da-zA-Z]+)$/)[1].replace(/^0+/,'')
          ].join('-')

          node.regesta = neo4jRegestaId;

          
          // how can we connect to the graph? (get the id regex)
          neo4j.query('MATCH (n:Regest {nummer:{neo4jRegestaId}}) OPTIONAL MATCH (n)-[r]-(t) RETURN n,r,t', {
            neo4jRegestaId: neo4jRegestaId
          }, function(err, triplets){
            if(err){
              console.log(err)
              throw 'neo4 error'
            }
            console.log(clc.blackBright('  get neo4j data for nummer:', clc.cyanBright(neo4jRegestaId), 'connected with n.nodes:'), triplets.length - 1);
            graph.nodes.push(node);

            _(triplets).filter('r').each(function(d, i) {
              
              if(!d.t.name3 && !d.t.name2){
                console.log(clc.redBright('  skipping node'), clc.magentaBright('(n:Lemma {xmlid:"'+d.t.xmlid+'"})'), 'no name was found')
                return;
              }

              var entitySlug = d.t.id;
              graph.nodes.push({
                slug: entitySlug,
                type: 'person',
                name: d.t.name3 || d.t.name2,
                description: d.t.name3,
                links_xmlid: d.t.xmlid
              });

              graph.links.push({
                source: entitySlug,
                target: node.slug,
                type: d.r.type == 'GENANNT_IN'? 'APPEARS_IN': 'RECEIVED_IN',
                properties: d.r.properties
              })
            });

            graph.nodes = _.uniq(graph.nodes, 'slug');
            // write graph json file!
            file.contents = new Buffer(JSON.stringify(graph));
            done(null, file);
          });
        })
        
      })
    }())
    .pipe(plug.rename({
      extname: ".json"
    }))
    .pipe(gulp.dest(dest))
    .pipe(plug.size({
      title: 'distill-regestae'
    }));
});



gulp.task('default', ['distill-regestae']);
