var gulp        = require('gulp'),
    pkg         = require('./package.json'),
    plug        = require('gulp-load-plugins')(),
    through     = require('through2'),
    async       = require('async'),
    _           = require('lodash'),

    path        = require('path'),
    
    settings    = require('./settings');



gulp.task('distill', function() {
  var src = path.resolve(__dirname, settings.paths.src),
      dest = path.resolve(__dirname, settings.paths.dest);
  console.log('src:  ', src)
  console.log('dest: ', dest)

  return gulp.src(src)
    .pipe(function(){
      return through.obj(function (file, encoding, done) {
        if(file.isNull())
          return done(null, file);
        // get the list of webpages urls


        // transform the files
        console.log(file.path);


        done(null, file);
      })
    }())
    .pipe(plug.rename({
      extname: ".json"
    }))
    .pipe(gulp.dest(dest))
    .pipe(plug.size({
      title: 'distill'
    }));
});



gulp.task('default', ['distill']);
