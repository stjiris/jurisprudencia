const es = require('@elastic/elasticsearch')
const client = new es.Client({ node: process.env.ES_URL || 'http://localhost:9200' });

const Index = module.exports.Index = "jurisprudencia.7.0";
const Properties = module.exports.Properties = {
    "Original": {
        type: 'object',
        enabled: false
    },
    "Tipo": {
        type: 'keyword',
        normalizer: 'term_normalizer'
    },
    "Processo": {
        type: 'keyword',
        normalizer: 'term_normalizer'
    },
    "Data": {
        type: 'date',
        format: 'dd/MM/yyyy'
    },
    "Relator": {
        type: 'text',
        fields: {
            raw: {
                type: "keyword"
            },
            keyword: {
                type: "keyword",
                normalizer: 'term_normalizer'
            }
        }
    },
    "Descritores": {
        type: 'text',
        fielddata: true,
        fields: {
            raw: {
                type: "keyword"
            },
            keyword: {
                type: 'keyword',
                normalizer: 'term_normalizer'
            }
        }
    },
    "Meio Processual": {
        type: 'text',
        fielddata: true,
        fields: {
            raw: {
                type: "keyword"
            },
            keyword: {
                type: 'keyword',
                normalizer: 'term_normalizer'
            }
        }
    },
    "Votação": {
        type: 'text',
        fielddata: true,
        fields: {
            raw: {
                type: "keyword"
            },
            keyword: {
                type: 'keyword',
                normalizer: 'term_normalizer'
            }
        }
    },
    "Secção": {
        type: 'text',
        fields: {
            raw: {
                type: "keyword"
            },
            keyword: {
                type: 'keyword',
                normalizer: 'term_normalizer'
            }
        }
    },
    "Decisão": {
        type: 'text',
        fields: {
            raw: {
                type: "keyword"
            },
            keyword: {
                type: 'keyword',
                normalizer: 'term_normalizer'
            }
        }
    },
    "Sumário": {
        type: 'text',
        term_vector: 'with_positions_offsets_payloads'
    },
    "Texto": {
        type: 'text',
        term_vector: 'with_positions_offsets_payloads'
    },
    "URL": {
        type: 'keyword',
    },
    "UUID": {
        type: 'keyword'
    },
    "HASH":{
        type: "object",
        properties: {
            "Original": { type: "keyword" },
            "Metadados": { type: "keyword" },
            "Texto": { type: "keyword" },
            "Sumário" : { type: "keyword" },
            "Processo" : { type: "keyword" }
        }
    },
    "CONTENT": {
        type: 'text'
    }
}

module.exports.delete = () => client.indices.delete({ index: Index });
module.exports.exists = () => client.indices.exists({ index: Index });
module.exports.create = () => client.indices.create({
    index: Index,
    mappings: {
        dynamic_date_formats: ['dd/MM/yyyy'],
        properties: Properties
    },
    settings: {
        analysis: {
            normalizer: {
                term_normalizer: {
                    type: 'custom',
                    filter: ['uppercase', 'asciifolding']
                }
            },
            analyzer: {
                default: {
                    char_filter: ['html_strip'],
                    filter: ['trim', 'lowercase', 'stopwords_pt', 'asciifolding'],
                    tokenizer: 'classic',
                }
            },
            filter: {
                stopwords_pt: {
                    type: 'stop',
                    ignore_case: true,
                    stopwords_path: "stopwords_pt.txt"
                }
            }
        },
        number_of_shards: 1,
        number_of_replicas: 0,
        max_result_window: 550000
    }
});

if( require.main == module ){
    module.exports.exists().then( async exists => {
        if( !exists ){
            console.log("Creating index...", Index);
            await module.exports.create();
        }
        else{
            console.log("Index already exists", Index);
        }
    }).catch( err => {
        console.log( err );
    });
}