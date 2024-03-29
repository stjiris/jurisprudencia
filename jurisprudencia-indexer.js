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
const getSecçãoFromDocument = require("./section-rules");

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

const FULL_UPDATE = process.argv.some(f => f === "--full" || f === "-f")
const SOFT_UPDATE = process.argv.some(f => f === "--soft" || f === "-s")
const HELP =  process.argv.some(f => f === "--help" || f === "-h" )
const CHECK_KNOW_LINKS = FULL_UPDATE && !SOFT_UPDATE;

if( HELP ){
    showHelp();
    return 1;
}

if( SOFT_UPDATE && FULL_UPDATE ){
    console.error("ERROR: Incompatible arguments --full and --soft")
    showHelp();
    return 2;
}

function showHelp(){
    console.log(`Usage: node jurisprudencia-indexer.js [OPTION]`)
    console.log(`Web scrapper for "http://www.dgsi.pt/jstj.nsf/" that populates the index "${jurisprudencia.Index}" of a elasticsearch instance on the location defined by $ES_URL (defaults to http://localhost:9200/)${process.env.ES_URL ? " (current value: ${process.env.ES_URL})" : ""}`)
    console.log(`Arguments:`)
    console.log(`    --help, -h    display this help and exit`)
    console.log(`    --full, -f    full update, checks every link for changes [default]`)
    console.log(`    --soft, -s    soft update, checks only new links`)
    console.log(`Note that: --full and --soft are incompatible arguments`)
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
    if( !CHECK_KNOW_LINKS ){
        if( await urlIsIndexed(url) ){
            report.indexSkipedCount++;
            return;
        }
    }
    let table = await url2table(url);
    let original = {}
    let keyData = "Data do Acordão";
    let tipo = "Acordão";
    let data = "01/01/1900";
    let CONTENT = [];
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
        CONTENT.push(table[key].textContent.trim())
    });
    data = table[keyData].textContent.trim().replace(/-/g, '/');
    let object = {
        "Original": original,
        "Número de Processo": table.Processo.textContent.trim().replace(/\s-\s.*$/, "").replace(/ver\s.*/, ""),
        "ECLI": "{sem ECLI}",
        "Data": data,
        "Relator Nome Profissional": table["Relator"].textContent.trim(),
        "Relator Nome Completo": table["Relator"].textContent.trim(),
        "Descritores": getDescritores(table),
        "Meio Processual": getMeioProcessual(table),
        "Votação - Decisão": getVotação(table),
        "Votação - Vencidos": getVotação(table),
        "Votação - Declarações": getVotação(table),
        "Secção": getSecçãoFromDocument(original),
        "Área": getSecçãoFromDocument(original),
        "Decisão": getDecisao(table),
        "Decisão (textual)": getDecisao(table),
        "Tribunal de Recurso": getTribunalRecurso(table),
        "Tribunal de Recurso - Processo": getTribunalRecursoProc(table),
        "Área Temática": ["«n.d.»"], // TODO: auto-populate this fields START
        "Jurisprudência Estrangeira": ["«n.d.»"], 
        "Jurisprudência Internacional": ["«n.d.»"],
        "Doutrina": ["«n.d.»"],
        "Jurisprudência Nacional": ["«n.d.»"],
        "Legislação Comunitária": ["«n.d.»"],
        "Legislação Estrangeira": ["«n.d.»"],
        "Legislação Nacional": ["«n.d.»"],
        "Referências Internacionais": ["«n.d.»"],
        "Indicações Eventuais": ["«n.d.»"], // END
        "Referência de publicação": ["«n.d.»"],
        "Jurisprudência": ["«n.d.»"],
        "Sumário": strip_attrs(table["Sumário"]?.innerHTML || ""),
        "Texto": strip_attrs(table["Decisão Texto Integral"]?.innerHTML || ""),
        "Fonte": "STJ (DGSI)",
        "CONTENT": CONTENT,
        "URL": url
    }
    object["HASH"] = {
        "Original": calculateUUID(object, ["Original"]),
        "Sumário": calculateUUID(object, ["Sumário"]),
        "Texto": calculateUUID(object, ["Texto"]),
        "Processo": calculateUUID(object, ["Processo"])
    }
    object["UUID"] = calculateUUID(object["HASH"], ["Sumário","Texto","Processo"]);
    await reportIndex(object).catch(e => {
        console.log("Fail", e);
        report.indexConflitsFound.push(e.toString());
    });
    
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
    return ["sem Descritores"]
}

function getMeioProcessual(table){
    if( table["Meio Processual"] ){
        return table["Meio Processual"].textContent.trim().split(/(\/|-)/g);
    }
    return ["sem Meio Processual"];
}

function getDecisao(table){
    if( table["Decisão"] ){
        return [table["Decisão"].textContent.trim()];
    }
    return ["sem Decisão"];
}

function getTribunalRecurso(table){
    if( table["Tribunal Recurso"] ){
        return table["Tribunal Recurso"].textContent.trim()
    }
    return "{sem Tribunal de Recurso}"
}

function getTribunalRecursoProc(table){
    if( table["Processo no Tribunal Recurso"] ){
        return table["Processo no Tribunal Recurso"].textContent.trim()
    }
    return "{sem Processo no Tribunal de Recurso}"
}

function getVotação(table){
    if( table.Votação ){
        let text = table.Votação.textContent.trim();
        if( text.match(/^-+$/) ) return null;
        if( text.match(/unanimidade/i) ){
            return ["Unanimidade"];
        }
        else{
            return [text];
        }
    }
    return ["sem Votação"];
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
            doc: obj
        });
    }
    else if( newhashes.Metadados != savedhashes.Metadados ){
        report.indexUpdatedCount++;
        await client.update({
            id: r.hits.hits[0]._id,
            index: jurisprudencia.Index,
            doc: obj
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
            await fn(decision).catch(e => {
                console.log("ERROR on", decision)
                console.log(e)
            });
        }
        if( next == currurl ){
            break;
        }
        currurl = next
    }
}