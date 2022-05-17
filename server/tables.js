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
