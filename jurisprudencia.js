const es = require('@elastic/elasticsearch')
const client = new es.Client({ node: 'http://localhost:9200' });

const Index = module.exports.Index = "jurisprudencia.6.0";
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
        type: 'object',
        properties: {
            "Forma": {
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
            "Voto Vencido": {
                type: 'float'
            },
            "Declaração de Voto": {
                type: 'float'
            },
            "Voto de Desempate": {
                type: 'float'
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
            "Sumário" : { type: "keyword" }
        }
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
                    stopwords: ["de", "a", "o", "que", "e", "do", "da", "em", "um", "para", "com", "não", "uma", "os", "no", "se", "na", "por", "mais", "as", "dos", "como", "mas", "ao", "ele", "das", "à", "seu", "sua", "ou", "quando", "muito", "nos", "já", "eu", "também", "só", "pelo", "pela", "até", "isso", "ela", "entre", "depois", "sem", "mesmo", "aos", "seus", "quem", "nas", "me", "esse", "eles", "você", "essa", "num", "nem", "suas", "meu", "às", "minha", "numa", "pelos", "elas", "qual", "nós", "lhe", "deles", "essas", "esses", "pelas", "este", "dele", "tu", "te", "vocês", "vos", "lhes", "meus", "minhas", "teu", "tua", "teus", "tuas", "nosso", "nossa", "nossos", "nossas", "dela", "delas", "esta", "estes", "estas", "aquele", "aquela", "aqueles", "aquelas", "isto", "aquilo", "estou", "está", "estamos", "estão", "estive", "esteve", "estivemos", "estiveram", "estava", "estávamos", "estavam", "estivera", "estivéramos", "esteja", "estejamos", "estejam", "estivesse", "estivéssemos", "estivessem", "estiver", "estivermos", "estiverem", "hei", "há", "havemos", "hão", "houve", "houvemos", "houveram", "houvera", "houvéramos", "haja", "hajamos", "hajam", "houvesse", "houvéssemos", "houvessem", "houver", "houvermos", "houverem", "houverei", "houverá", "houveremos", "houverão", "houveria", "houveríamos", "houveriam", "sou", "somos", "são", "era", "éramos", "eram", "fui", "foi", "fomos", "foram", "fora", "fôramos", "seja", "sejamos", "sejam", "fosse", "fôssemos", "fossem", "for", "formos", "forem", "serei", "será", "seremos", "serão", "seria", "seríamos", "seriam", "tenho", "tem", "temos", "tém", "tinha", "tínhamos", "tinham", "tive", "teve", "tivemos", "tiveram", "tivera", "tivéramos", "tenha", "tenhamos", "tenham", "tivesse", "tivéssemos", "tivessem", "tiver", "tivermos", "tiverem", "terei", "terá", "teremos", "terão", "teria", "teríamos", "teriam"]
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