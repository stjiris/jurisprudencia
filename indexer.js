const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: 'http://localhost:9200' });

const mapping = require('./elastic-index-mapping.json');

module.exports.init = async (removeOld=false) => {
    if( removeOld ) await client.indices.delete({index: mapping.index})
    let ex = await client.indices.exists({index: mapping.index})
    if( !ex ){
        await client.indices.create(mapping) 
    }
}

module.exports.updateProperties = () => client.indices.putMapping({index: mapping.index, properties: mapping.mappings.properties})

module.exports._client = client;

module.exports.updateDocument = () =>
    client.updateByQuery({
        index: mapping.index,
        script: {
            source: "ctx._source['Origem'] = ctx._source['Original URL'].indexOf('dgsi') >= 0 ? 'dgsi-indexer' : 'tcon-indexer'",
            lang: "painless"
        },
        query: {
            bool: {
                must_not: {
                    "exists": {
                        "field": "Origem"
                    }
                }
            }
        },
        conflicts: "proceed"
    })

module.exports.index = (json) =>{
    let body = {}
    for( let key in mapping.mappings.properties ){
        if( !json[key] ){
            throw new Error(`Missing field ${key}`)
        }
        body[key] = json[key]
    }
    return client.index({index: mapping.index,body});
}

module.exports.exists = (json) => 
    client.count({
        index: mapping.index, 
        body: {
            query: {
                term: {
                    Tribunal: json.Tribunal,
                },
                term: {
                    Processo: json.Processo,
                }
            }
        }
    }).then( ({count}) => count > 0)

module.exports.dry_run = function dry_run(json){
    let body = {}
    for( let key in mapping.mappings.properties ){
        if( !json[key] ){
            throw new Error(`Missing field ${key}`)
        }
        body[key] = json[key]
    }
    return body
}

module.set