# 5-steps Regesta

(first of all, neo4j start for the original regesta neo4j)

## 1. install 
Install `gulp` as global and install locally the dependencies packages for this project

  	npm install -g gulp
  	npm install


## 2. harvest-collections task

get the COLLECTION regestae xml files from the server
Please check your `settings.collections` for the url list and
`settings.paths.collections` for the output

  	gulp harvest-collections

## 3. harvest-regestae task
download the regestae xml files from the server

  	gulp harvest-regestae

## 4. distill-regestae
parse the regesta files
  
  	gulp distill-regestae

## 5. import JSON graph files in histograph
  
  	cd histograph
  	node scripts/manage.js --task=import.fromJSON --src=/path/to/regestae-json/**/*.json

## 6. Change labels (in histrograph database)

    MATCH (n:person) WHERE n.name_search =~ '.*stadt.*//.*' REMOVE n:person SET n:location
    MATCH (n:person) WHERE n.name_search =~ '.*stadt.*$' REMOVE n:person SET n:location;
    
## 7. Add Full-Text-Search
    
    MATCH (n:resource) WHERE not(has(n.full_search)) WITH n SET n.full_search = LOWER(n.name + ' ' + n.caption_de), n.title_search = LOWER(n.name);
    MATCH (n:resource) SET n.full_search = n.full_search;
    
