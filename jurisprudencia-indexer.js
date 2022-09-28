const url2table = require('./util/url-to-table');
const es = require('@elastic/elasticsearch')
const client = new es.Client({ node: process.env.ES_URL || 'http://localhost:9200' });
const DGSI_LINK = "http://www.dgsi.pt/jstj.nsf?OpenDatabase";
const DGSI_PATTERN = /http:\/\/www\.dgsi\.pt\/jstj\.nsf\/(?<hashsjt>.*)\/(?<hashid>.*)\?OpenDocument/;
const jurisprudencia = require('./jurisprudencia');
const fetch = require('./util/fetch');
const { strip_attrs } = require('./util/html');
const crypto = require("crypto");
const { writeFileSync } = require('fs');

let report = {
    /* Timing report */
    timeStartAt: new Date(),
    timeEndAt: new Date(),
    /* Indexing report */
    indexTotalCount: 0,
    indexNewCount: 0,
    indexUpdatedCount: 0,
    indexNotUpdatedCount: 0,
    indexConflitsFound: [],
    /* Requests report */
    fetchTotalCount: 0,
    fetchTotalBytes: 0,
    fetchTotalTime: 0,
    fetchAvgTime: 0,
    fetchAvgBytes: 0
}

require('./util/fetch').watchFetchStats( pageDownloadedStats => {
    report.fetchTotalCount++;
    report.fetchTotalBytes+=pageDownloadedStats.bytes;
    report.fetchTotalTime+=pageDownloadedStats.end - pageDownloadedStats.start;
});

process.on('SIGINT', function() { // doesn't work on winds
    console.log("Caught interrupt signal. Saving current report status.");
    saveReport();
    process.exit();
});

function saveReport(){
    report.timeEndAt = new Date();
    report.fetchAvgBytes = report.fetchTotalBytes / report.fetchTotalCount;
    report.fetchAvgTime = report.fetchTotalTime / report.fetchTotalCount;
    writeFileSync(`indexer-report-${Date.now()}.json`, JSON.stringify(report, null, "  "));
}

forEachDgsiLink(async url => {
    let table = await url2table(url);
    let original = {}
    let keyData = "Data do Acordão";
    let tipo = "Acordão";
    let data = "01/01/1900";
    Object.keys( table ).forEach( key => {
        if( key.startsWith("Data") ){
            original[key] = table[key].textContent.trim().replace(/-/g, '/')
        }
        else{
            original[key] = table[key].innerHTML;
        }
        if( key.match(/Data d. (.*)/) ){
            if( tipo == "Acordão"){
                // From experiments, Data do Acórdão appears first. Only Data da Decisão Sumária and Data da Decisão Singular might appear with Data do Acórdão.
                // However, in case this order changes, let's prevent variable tipo from changing after it ins't Acórdão. 
                tipo = key.match(/Data d. (.*)/)[1].trim();
                keyData = key;
            }
        }
    });
    data = table[keyData].textContent.trim().replace(/-/g, '/');
    let object = {
        "Original": original,
        "Tipo": tipo,
        "Processo": table.Processo.textContent.trim().replace(/\s-\s.*$/, "").replace(/ver\s.*/, ""),
        "Data": data,
        "Relator": table["Relator"].textContent.trim(),
        "Descritores": getDescritores(table),
        "Meio Processual": getMeioProcessual(table),
        "Votação": getVotação(table),
        "Secção": getSeccao(table),
        "Decisão": getDecisao(table),
        "Sumário": strip_attrs(table["Sumário"]?.innerHTML || ""),
        "Texto": strip_attrs(table["Decisão Texto Integral"]?.innerHTML || ""),
        "URL": url
    }
    object["HASH"] = {
        "Original": calculateUUID(object, ["Original"]),
        "Metadados": calculateUUID(object, ["Tipo","Processo","Data","Relator","Descritores","Meio Processual", "Votação", "Secção", "Decisão"]),
        "Sumário": calculateUUID(object, ["Sumário"]),
        "Texto": calculateUUID(object, ["Texto"]),
    }
    object["UUID"] = calculateUUID(object["HASH"], ["Sumário","Texto"]);

    await reportIndex(object);
}).then( _ => {
    saveReport();
}).catch(e => {
    console.log(e);
    report.error = e;
    saveReport();
})

function getDescritores(table){
    if( table.Descritores ){
        // TODO: handle , and ; in descritores (e.g. "Ação Civil; Ação Civil e Administrativa") however dont split some cases (e.g. "Art 321º, do código civil")
        return table.Descritores.textContent.trim().split(/\n|;/).map( desc => desc.trim().replace(/\.$/g,'').replace(/^(:|-|,|"|“|”|«|»|‘|’)/,'').trim() ).filter( desc => desc.length > 0 )
    }
    return []
}

function getMeioProcessual(table){
    if( table["Meio Processual"] ){
        return table["Meio Processual"].textContent.trim();
    }
    return null;
}

function getDecisao(table){
    if( table["Decisão"] ){
        return table["Decisão"].textContent.trim();
    }
    return null;
}

function getVotação(table){
    if( table.Votação ){
        let text = table.Votação.textContent.trim();
        if( text.match(/^-+$/) ) return null;
        if( text.match(/unanimidade/i) ){
            return {
                "Forma": "Unanimidade"
            };
        }
        else{
            return {
                "Forma": text,
                "Voto Vencido": 100,
                "Declaração de Voto": 100,
                "Voto de Desempate": 100
            };
        }
    }
    return null;
}

function getSeccao(table){
    if( table["Nº Convencional"] ){
        return table["Nº Convencional"].textContent.trim();
    }
    return null;
}

function calculateUUID(table, keys=[]){
    let str = JSON.stringify(table, keys);
    let hash = crypto.createHash("sha1");
    hash.write(str);
    return hash.digest().toString("base64url");
}

async function reportIndex(obj){
    report.indexTotalCount++;
    let r = await client.search({
        index: jurisprudencia.Index,
        query: {
            term: {
                URL: obj.URL
            }
        },
        _source: ["HASH"]
    });
    if(r.hits.total.value == 0 ){
        report.indexNewCount++;
        await client.index({
            index: jurisprudencia.Index,
            body: obj
        });
        return;
    }
    let newhashes = obj.HASH;
    let savedhashes = r.hits.hits[0]._source.HASH;
    if( newhashes.Texto != savedhashes.Texto ){
        report.indexConflitsFound.push({
            url: obj.URL,
            message: "Texto foi atualizado. Atualização ignorada."
        });
        report.indexNotUpdatedCount++;
        return;
    }
    else if( newhashes["Sumário"] != savedhashes["Sumário"] ){
        report.indexConflitsFound.push({
            url: obj.URL,
            message: "Sumário foi atualizado. UUID atuzalizado."
        });
        report.indexUpdatedCount++;
        await client.update({
            id: r.hits.hits[0]._id,
            index: jurisprudencia.Index,
            _source: obj
        });
    }
    else if( newhashes.Metadados != savedhashes.Metadados ){
        report.indexUpdatedCount++;
        await client.update({
            id: r.hits.hits[0]._id,
            index: jurisprudencia.Index,
            _source: obj
        })
    }
}

async function urlIsIndexed( url ){
    let res = await client.search({
        index : jurisprudencia.Index,
        query: {
            term: {
                URL: url
            }
        }
    })
    return res.hits.total.value > 0;
}

async function forEachDgsiLink( fn ){
    let visited = {}
    let currurl = DGSI_LINK;
    while( true ){
        let page = await fetch.dom(currurl);
        let anchorList = Array.from(page.window.document.querySelectorAll("a"))
        let next = anchorList.find( l => l.textContent == "Seguinte" ).href
        let courtList = anchorList.map(a => a.href).filter(u => u.match(DGSI_PATTERN))
        for( let decision of courtList ){
            if( decision in visited ) continue;
            visited[decision] = true;
            await fn(decision);
        }
        if( next == currurl ){
            break;
        }
        currurl = next
    }
}