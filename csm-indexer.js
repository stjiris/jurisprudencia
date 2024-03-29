const url2table = require('./util/url-to-table');
const es = require('@elastic/elasticsearch')
const client = new es.Client({ node: process.env.ES_URL || 'http://localhost:9200'});
const fetch = require('./util/fetch');
const { strip_attrs } = require('./util/html');
const crypto = require("crypto");
const { writeFileSync } = require('fs');
const getSecçãoFromOriginal = require('./section-rules')
const Secções = getSecçãoFromOriginal.SECÇÕES;

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0; // invalid cert by csm

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
    /* Skips */
    indexSkipedCount: 0,
    /* Requests report */
    fetchTotalCount: 0,
    fetchTotalBytes: 0,
    fetchTotalTime: 0,
    fetchAvgTime: 0,
    fetchAvgBytes: 0
}

fetch.watchFetchStats( pageDownloadedStats => {
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
    writeFileSync(`indexer-csm-report-${Date.now()}.json`, JSON.stringify(report, null, "  "));
}

forEachCsmLink(async url => {
    let r = await client.search({
        index: "jurisprudencia-csm.tmp.0.0",
        query: {
            term: {
                "URL": url
            }
        }
    });
    if( r.hits.hits.length > 0 ){
        return;
    }
    let ecli = url.match(/ECLI:PT:STJ:(?<year>\d+):(?<dottedproc>.*)\.\w{2}\//)
    if( ecli ){
        let possibleProc = ecli.groups.dottedproc.replace(/\./, "/").replace(/\.(\w)\./, "-$1."); //replace only FIRST .(dot) with /(slash) (regex without global flag)
        console.log(possibleProc);
        r = await client.search({
            index: "jurisprudencia.6.0",
            query: {
                wildcard: {
                    Processo: possibleProc
                }
            }
        });
        if( r.hits.hits.length > 0 ){
            return;
        }
    }
    console.log("url2table");
    await fetch.sleep(11*1000); // Sleep 11 seconds before another request
    let table = await url2table(url);
    let proc = table.Processo.textContent.trim().replace(/\s-\s.*$/, "").replace(/ver\s.*/, "");
    console.log("Actual processo:", proc);
    r = await client.search({
        index: "jurisprudencia.6.0",
        query: {
            wildcard: {
                Processo: proc
            }
        }
    });
    if( r.hits.hits.length > 0 ){
        return;
    }
    console.log(proc)
    let original = {};
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
    if( !table[keyData] ) keyData = "Data"
    data = table[keyData].textContent.trim().replace(/-/g, '/');
    let object = {
        "Original": original,
        "Tipo": tipo,
        "Processo": proc,
        "Data": data,
        "Relator": table.Relator.textContent.trim(),
        "Descritores": getDescritores(table),
        "Meio Processual": getMeioProcessual(table),
        "Votação": getVotação(table),
        "Secção": getSecçãoÁreaTemática(table, original),
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
});

function calculateUUID(table, keys=[]){
    let str = JSON.stringify(table, keys);
    let hash = crypto.createHash("sha1");
    hash.write(str);
    return hash.digest().toString("base64url");
}

function getDescritores(table){
    if( !("Descritores" in table) ) return [];

    let Desc = table["Descritores"].textContent.split("; ");
    return Desc;
}

function getMeioProcessual(table){
    if( !("Meio Processual" in table) ){
        return null;
    }
    return table["Meio Processual"].textContent.trim();
}

function getVotação(table){
    if( !("Votação" in table) ) return null;
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

function getDecisao(table){
    if( !("Decisão" in table)) return null;

    return table.Decisão.textContent.trim();
}

function getSecçãoÁreaTemática(table, original){
    if( !("Área Temática" in table)){
        return getSecçãoFromOriginal(original)
    }
    let possibleSecção = table["Área Temática"].textContent.trim();
    if( possibleSecção.match(/Contencioso/i) ){
        return Secções.SECÇÃO_C;
    }

    if( possibleSecção.match(/se/i) && possibleSecção.match(/^(1|2|3|4|5|6|7)/) ){
        let number = possibleSecção[0];
        let key = `SECÇÃO_${number}`;
        return Secções[key]
    }

    return getSecçãoFromOriginal(original);
}

async function reportIndex(obj){
    report.indexTotalCount++;
    let r = await client.search({
        index: "jurisprudencia-csm.tmp.0.0",
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
            index: "jurisprudencia-csm.tmp.0.0",
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
            index: "jurisprudencia-csm.tmp.0.0",
            doc: obj
        });
    }
    else if( newhashes.Metadados != savedhashes.Metadados ){
        report.indexUpdatedCount++;
        await client.update({
            id: r.hits.hits[0]._id,
            index: "jurisprudencia-csm.tmp.0.0",
            doc: obj
        })
    }
}

async function forEachCsmLink( fn ){
    let page = parseInt(process.env.START_PAGE || 0);
    let inc = 200;
    let items;
    do{
        console.log(`Last START_PAGE=${page}`)
        items = await fetch.json(`https://jurisprudencia.csm.org.pt/items/loadItems?queries[courts][]=1&sorts[dataAcordao]=-1&perPage=${inc}&offset=${page}`);
        console.log(`Last START_PAGE=${page} found ${items.records.length}`)
        let i = 0;
        for( let item of items.records ){
            console.log(`Last START_PAGE=${page} ran ${i++} of ${items.records.length}`)
            let url = `https://jurisprudencia.csm.org.pt/ecli/${item.ecli}/`;
            await fn( url );
        }
        page+=inc;
        await fetch.sleep(11*1000*1000);
    }
    while(items.records.length > 0);
}