const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: 'http://localhost:9200' });

const mapping = require('./elastic-index-mapping.json');
const fixKnownErrors = require('./fix-known-errors');

module.exports.init = async (removeOld=false) => {
    if( removeOld ) await client.indices.delete({index: mapping.index})
    let ex = await client.indices.exists({index: mapping.index})
    if( !ex ){
        await client.indices.create(mapping) 
    }
}

module.exports.updateProperties = () => client.indices.putMapping({index: mapping.index, properties: mapping.mappings.properties})

module.exports._client = client;

module.exports.updateDocument = (source, query) =>
    client.updateByQuery({
        index: mapping.index,
        script: {
            source: source,
            lang: "painless"
        },
        query: query,
        conflicts: "proceed"
    })

module.exports.index = (json) =>{
    let body = {}
    for( let key in mapping.mappings.properties ){
        if( !(key in json) ){
            Promise.reject(`Missing key: ${key}`)
        }
        body[key] = json[key]
    }
    return client.index({index: mapping.index, fixKnownErrors(body)});
}

module.exports.exists = (json) => 
    client.count({
        index: mapping.index, 
        body: {
            query: {
                bool: {
                    must: [
                        {
                            term: {
                                Tribunal: json.Tribunal
                            }
                        },
                        {
                            term: {
                                Processo: json.Processo
                            }
                        },
                        {
                            term: {
                                Origem: json.Origem
                            }
                        }
                    ]
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

/*
    1# Update: set Origem from the original URL
    source:
        "ctx._source['Origem'] = ctx._source['Original URL'].indexOf('dgsi') >= 0 ? 'dgsi-indexer' : 'tcon-indexer'"
    query:
    {
        bool: {
            must_not: {
                "exists": {
                    "field": "Origem"
                }
            }
        }
    }

    2# Update: remove (até 1998) from Tribunal Constitucional
    source:
        "ctx._source['Tribunal'] = 'Tribunal Constitucional'"
    query:
    {
        term: {
            Tribunal: "Tribunal Constitucional (até 1998)"
        }
    }

    3# Update: remove ver acórdão ... from Processo
    source:
        "ctx._source['Processo'] = /ver.*\/.matcher(ctx._source['Processo']).replaceAll('')"
    query:
    {
        wildcard: {
            Processo: {
                value: "*ver *"
            }
        }
    }

    4# Updade: remove VER.* from ECLI
    source:
        "ctx._source['ECLI'] = /VER.AC.*\/.matcher(ctx._source['ECLI']).replaceAll('')"
    query:
    {
        wildcard: {
            ECLI: {
                value: "*VER.AC.*"
            }
        }
    }
*/