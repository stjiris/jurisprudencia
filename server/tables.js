const {Router, static} = require("express");
const indexer = require("../indexer");
const path = require("path");

const app = Router();
module.exports = app;

const agg = (obj) => indexer._client.search({
    index: indexer.mapping.index,
    size: 0,
    aggs: obj
}).then((res) => res.aggregations);

const tables = [];
function defineTable(name, cb){
    tables.push(name);
    app.get(`/${name}`, (req, res) => cb().then( ({header, values}) => res.render("tables", {header, values}) ).catch(e => res.render("tables", {header: [], values: [], error: e})||console.log(e)));
}

defineTable("ano-origem", ()=>agg({
    Ano: {
        date_histogram: {
            field: "Data",
            interval: "year",
            min_doc_count: 0,
            format: "yyyy"
        },
        aggs: {
            Origem: {
                terms: {
                    field: "Origem",
                    size: 15,
                    min_doc_count: 0
                }
            }
        }
    }
}).then(aggs => {
    let origens = aggs.Ano.buckets[0].Origem.buckets.map(bucket => bucket.key).sort((b1,b2) => b1.localeCompare(b2));
    let header = ["Ano\\Origem", "Total", ...origens];
    let values = aggs.Ano.buckets.map(b => [b.key_as_string, b.doc_count, ...(b.Origem.buckets.length > 0 ? b.Origem.buckets.sort((b1,b2) => b1.key.localeCompare(b2.key)) : origens.map(() => ({doc_count:0}))).map(b => b.doc_count)]);
    return {header, values};
}));

defineTable("ano-tribunal", ()=>agg({
    Ano: {
        date_histogram: {
            field: "Data",
            interval: "year",
            min_doc_count: 0,
            format: "yyyy"
        },
        aggs: {
            Tribunal: {
                terms: {
                    field: "Código Tribunal",
                    size: 15,
                    min_doc_count: 0
                }
            }
        }
    }
}).then(aggs => {
    let tribunais = aggs.Ano.buckets[0].Tribunal.buckets.map(bucket => bucket.key).sort((b1,b2) => b1.localeCompare(b2));
    let header = ["Ano\\Tribunal", "Total", ...tribunais];
    let values = aggs.Ano.buckets.map(b => [b.key_as_string, b.doc_count, ...(b.Tribunal.buckets.length > 0 ? b.Tribunal.buckets.sort((b1,b2) => b1.key.localeCompare(b2.key)) : tribunais.map(() => ({doc_count:0}))).map(b => b.doc_count)]);
    return {header, values};
}));

defineTable("ecli-errado", () => indexer._client.search({
    index: indexer.mapping.index,
    query: {
        bool: {
            must: [
                {
                    exists: {
                        field: "_UNMATCHING_ECLI"
                    }
                }
            ]
        }
    },
    size: 65535,
    track_total_hits: true,
    _source: ["ECLI", "_UNMATCHING_ECLI"]
}).then((res) => {
    const header = ["ECLI", "ECLI_ERRADO", res.hits.total.value];
    const values = res.hits.hits.map((hit) => [hit._source.ECLI, hit._source._UNMATCHING_ECLI]);
    return {header, values};
}));

app.get("/", (req, res) => res.render("tables", {header: ["Tabelas"], values: tables.map((t) => [`<a href="./${t}">${t}</a>`])}));

app.get("/", async (req, res) => {
    let aggs = await agg({
        Histogram: {
            date_histogram: {
                field: "Data",
                interval: "year",
                format: "yyyy",
                min_doc_count: 1
            },
            aggs: {
                WrongECLI: {
                    filter: {
                        bool: {
                            must: {
                                exists: {
                                    field: "_UNMATCHING_ECLI"
                                }
                            }
                        }
                    }
                }
            }
        }
    });
    let keys = ["Ano", "Total", "Wrong ECLIs"];
    let data = aggs.Histogram.buckets.map((bucket) => { return [bucket.key_as_string, bucket.doc_count, bucket.WrongECLI.doc_count] });
    res.render("info-table", {
        header: keys,
        values: data
    });
    return
    console.log();
    indexer._client.search({
        size: 0,
        aggs: {
            Histogram: {
                date_histogram: {
                    field: "Data",
                    interval: "year",
                    format: "yyyy",
                    min_doc_count: 0
                },
                aggs: {
                    Origem: {
                        terms: {
                            field: "Origem",
                            size: 20,
                            min_doc_count: 0
                        }
                    },
                    WrongECLI: {
                        filter: {
                            bool: {
                                must: {
                                    exists: {
                                        field: "_UNMATCHING_ECLI"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }).then(body => {
        let Anos = body.aggregations.Histogram.buckets.map(bucket => bucket.key_as_string);
        let keys = body.aggregations.Histogram.buckets[0].Origem.buckets.map(bucket => bucket.key);
        let values = Anos.map(Ano => {
            let Total = body.aggregations.Histogram.buckets.find(bucket => bucket.key_as_string === Ano).doc_count;
            let WrongECLI = body.aggregations.Histogram.buckets.find(bucket => bucket.key_as_string === Ano).WrongECLI.doc_count;
            let values = keys.map(key => body.aggregations.Histogram.buckets.find(bucket => bucket.key_as_string === Ano).Origem.buckets.find(bucket => bucket.key === key)?.doc_count || 0);
            return [Ano,...values,Total,WrongECLI];
        });
        res.render("info-table", {
            header: ["Ano",...keys,"Total","TotalWrongECLI"],
            values: values
        });
    }).catch(err => {
        res.render("info-table", {
            header: ["ECLI","Origem","Total","TotalWrongECLI"],
            values: [],
            error: err
        });
    });
});

app.get("/duplicates", (req, res) => {
    indexer._client.search({
        size: 0,
        aggs: {
            ECLI: {
                terms: {
                    field: "ECLI",
                    min_doc_count: 2,
                    size: 65536/4,
                    collect_mode: "breadth_first"
                },
                aggs: {
                    Origem: {
                        terms: {
                            field: "Origem",
                            size: 4
                        }
                    }
                }
            }
        }
    }).then(body => {
        let ECLI = body.aggregations.ECLI.buckets;
        let values = ECLI.map(ECLI => {
            return [`<a href="/${ECLI.key}">${ECLI.key}</a>`, ECLI.Origem.buckets.map(bucket => bucket.key).join(", "), ECLI.doc_count];
        });
        res.render("info-table", {
            header: ["ECLI", "Origem", "Contagem (Incorreto)"],
            values: values
        });
    }).catch(err => {
        res.render("info-table", {
            header: ["ECLI","Origem", "Contagem (Incorreto)"],
            values: [],
            error: err
        });
    });
});

app.use(static(path.join(__dirname, "static")));