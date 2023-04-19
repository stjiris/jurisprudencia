const es = require('@elastic/elasticsearch');
const client = new es.Client({ node: process.env.ES_URL || 'http://localhost:9200' });

let map_source_original = {
    "Área Temática": {
        source: ["Área Temática", "tematica"],
        current: "Área Temática.raw"
    },
    "Data": {
        source: ["Data da Decisão Singular","Data da Decisão Sumária","Data da Reclamação","Data de decisão sumária","Data do Acordão","Data","dataAcordao"],
        current: "Data",
        missing: "01/01/0001"
    },
    "Decisão": {
        source: ["Decisão","decisao"],
        current: "Decisão.raw"
    },
    "Decisão (textual)": {
        source: ["Decisão","decisao"],
        current: "Decisão (textual).raw"
    },
    "Descritores": {
        source: ["Descritores","descritores"],
        current: "Descritores.raw",
        missing: "{}"
    },
    "Doutrina": {
        source: ["Doutrina"],
        current: "Doutrina.raw"
    },
    "ECLI": {
        source: ["ECLI","ecli"],
        current: "ECLI"
    },
    "Indicações Eventuais": {
        source: ["Indicações Eventuais","Indicações eventuais"],
        current: "Indicações Eventuais.raw"
    },
    "Jurisprudência Estrangeira": {
        source: ["Jurisprudência Estrangeira"],
        current: "Jurisprudência Estrangeira.raw"
    },
    "Jurisprudência Internacional": {
        source: ["Jurisprudência Internacional"],
        current: "Jurisprudência Internacional.raw"
    },
    "Jurisprudência Nacional": {
        source: ["Jurisprudência Nacional"],
        current: "Jurisprudência Nacional.raw"
    },
    "Legislação Comunitária": {
        source: ["Legislação Comunitária"],
        current: "Legislação Comunitária.raw"
    },
    "Legislação Estrangeira": {
        source: ["Legislação Estrangeira"],
        current: "Legislação Estrangeira.raw"
    },
    "Legislação Nacional": {
        source: ["Legislação Nacional"],
        current: "Legislação Nacional.raw"
    },
    "Meio Processual": {
        source: ["Meio Processual"],
        current: "Meio Processual.raw"
    },
    "Secção": {
        source: ["Nº Convencional"],
        current: "Secção.raw"
    },
    "Tribunal de Recurso - Processo": {
        source: ["Processo no Tribunal Recurso"],
        current: "Tribunal de Recurso - Processo.raw"
    },
    "Número de Processo": {
        source: ["Processo"],
        current: "Número de Processo"
    },
    "Referência de publicação": {
        source: ["Referência de Publicação"],
        current: "Referência de publicação.raw"
    },
    "Referências Internacionais": {
        source: ["Referências Internacionais"],
        current: "Referências Internacionais.raw"
    },
    "Relator Nome Profissional": {
        source: ["Relator","relator"],
        current: "Relator Nome Profissional.raw"
    },
    "Relator Nome Completo": {
        source: ["Relator","relator"],
        current: "Relator Nome Completo.raw"
    },
    "Tribunal de Recurso": {
        source: ["Tribunal Recurso"],
        current: "Tribunal de Recurso.raw"
    },
    "Votação - Decisão": {
        source: ["Votação"],
        current: "Votação - Decisão.raw"
    },
    "Votação - Vencidos": {
        source: ["Votação"],
        current: "Votação - Vencidos.raw"
    },
    "Votação - Declarações": {
        source: ["Votação"],
        current: "Votação - Declarações.raw"
    }
}

function originais(field){
    return client.search({
        index: "jurisprudencia.original",
        track_total_hits: true,
        size: 0,
        query: {
            exists: {
                field: field
            }
        },
        aggs: {
            [field]: {
                cardinality: {
                    precision_threshold: 40000,
                    field: field
                }
            }
        }
    }).then(r => [r.hits.total.value, r.aggregations[field].value])
}

function atuais(field){
    return client.search({
        index: "jurisprudencia.9.4",
        track_total_hits: true,
        size: 0,
        query: {
            bool: {
                must_not: [{
                    term: {
                        [map_source_original[field].current]: map_source_original[field].missing? map_source_original[field].missing : `«sem valor»`
                    }
                }]
            }
        },
        aggs: {
            [field]: {
                cardinality: {
                    precision_threshold: 40000,
                    field: map_source_original[field].current
                }
            }
        }        
    }).then( r => [r.hits.total.value, r.aggregations[field].value])
}

async function count(field,missing=null){
    let res1 = await Promise.all(map_source_original[field].source.map(originais));
    let registosOriginais = res1.reduce((acc, c) => acc + c[0],0)
    let valoresOriginais = res1.reduce((acc, c) => Math.max(acc, c[1]),0)
    let res2 = await atuais(field,missing)
    let registosAtuais = res2[0]
    let valoresAtuais = res2[1]
    console.log(`+usado("${field}",${registosOriginais},${valoresOriginais},${registosAtuais},${valoresAtuais})`)
}


(async () => {
    for( let k in map_source_original){
        await count(k)
    }
})()
