const { JSDOM, ResourceLoader } = require("jsdom");
const { workerData } = require("worker_threads");
const ecli = require('./ecli');
const indexer = require('./indexer');
const { strip_attrs } = require('./util')

let sleep = (time) => new Promise(resolve => {
    setTimeout(resolve, time);
})

let getPage = async (url) => {
    let page = null;
    while(page == null){
        page = await JSDOM.fromURL(url).catch(e => {
            log(`getPage(${url}): ${JSON.stringify(e)}`);
        return null })
        if( page == null ){
            await sleep(Math.random()*1000)
        }
    }

    return page;
}

let count = 0;

const { Tribunal, TribunalCode, link } = workerData;
const log = (msg) => console.log(`[WORKER ${TribunalCode}] ${msg}`)
log(`${link} - ${Tribunal}`);
let builder = new ecli.ECLI_Builder().setCountry("PT").setJurisdiction(TribunalCode).setYear("0000");

forEachCourtDecisionLink(async link => {
    let page = await getPage(link+'&ExpandSection=1');
    let tables = Array.from(page.window.document.querySelectorAll("table")).filter( o => o.parentElement.closest("table") == null );
    let table = tables
        .flatMap( table => 
            Array.from(table.querySelectorAll("tr")).filter( row => row.closest("table") == table ) )
        .filter( tr => tr.cells.length > 1 )
        .reduce(
            (acc, tr) => {
                let key = tr.cells[0].textContent.replace(":","").trim()
                let value = tr.cells[1];  
                acc[key] = value;
                return acc;
            }, {})
    
    let processo = table.Processo.textContent.trim().replace(/\s-\s.*$/, "");
    if( await indexer.exists({"Tribunal": Tribunal,"Processo": processo}) ){
        return;
    }
    try{
        let Data = getData(table);
        let datePT = USADateToPT(Data);
        let year = USADateToYear(Data);

        let body = {
            "ECLI": builder.setYear(year).setNumber(processo).build(),
            "Tribunal": Tribunal,
            "Processo": processo,
            "Relator": table.Relator.textContent.trim(),
            "Data": datePT,
            "Descritores": getDescritores(table),
            "Sumário": getSumario(table),
            "Texto": getTexto(table),
            "Original URL": link
        }
        await indexer.index(body);
        count++;

    }
    catch(e){
        console.log(`Error: ${link}`)
        console.log(e.stack)
    }
})

// JSDOM doenst allow to Accept-Language: en-GB making the dgsi.pt dates come in MM/dd/yyyy format
function USADateToPT(date){
    let m = date.match(/(?<month>\d+)\/(?<day>\d+)\/(?<year>\d+)/)
    return `${m.groups.day}/${m.groups.month}/${m.groups.year}`
}

function USADateToYear(date){
    let m = date.match(/(?<month>\d+)\/(?<day>\d+)\/(?<year>\d+)/)
    return m.groups.year
}

function getDescritores(table){
    if( table.Descritores ){
        return table.Descritores.textContent.trim().split("\n")
    }
    return []
}

function getTexto(table){
    if( "Decisão Texto Integral" in table ){
        return strip_attrs(table["Decisão Texto Integral"].innerHTML)
    }
    if( "Texto Integral" in table ){
        return strip_attrs(table["Texto Integral"].innerHTML)
    }
    return "N.A.";
}

function getSumario(table){
    if( "Sumário" in table ){
        return strip_attrs(table["Sumário"].innerHTML)
    }
    return "N.A.";
}

function getData(table){
    if( "Data do Acordão" in table ){
        return table["Data do Acordão"].textContent.trim();
    }
    if( "Data da Decisão Sumária" in table ){
        return table["Data da Decisão Sumária"].textContent.trim();
    }
    throw new Error("No date found")
}

/*
forEachCourtDecisionLink(async link => {
    let page = await getPage(link);
    let tables = Array.from(page.window.document.querySelectorAll("table")).filter( o => o.parentElement.closest("table") == null );
    let table = tables
        .flatMap( table => Array.from(table.querySelectorAll("tr"))
        .filter( row => row.closest("table") == table ) )
        .filter( tr => tr.cells.length > 1 )
        .reduce(
            (acc, tr) => {
                let key = tr.cells[0].textContent.replace(":","").trim()
                let value = tr.cells[1];  
                acc[key] = value;
                return acc;
            }, {})
    
    let processo = table.Processo.textContent.trim();
    // TODO: Check if process exists in elasticsearch

    let body = {
        "ECLI": builder.setNumber(processo).build(),
        "Tribunal": Tribunal,
        "Processo": processo,
        "Relator": table.Relator.textContent.trim(),
        "Data": table["Data do Acordão"].textContent.trim(),
        "Secção": table["Meio Processual"].textContent.trim(),
        "Descritores": table["Descritores"].textContent.trim().split("\n"),
        "Sumário": table["Sumário"].innerHTML,
        "Texto": table["Decisão Texto Integral"].innerHTML,
        "Original URL": link
    }

    indexer
    

    




    /*
    if( (await con.exists({ id: link, index: INDEX_NAME})).body ){
        return;
    }
    count++;
    let page = await getPage(link);
    let json = {
        court: fullname,
        link: link
    };
    for( let row of trs ){
        if( row.cells.length < 2 ) continue;
        let field = row.cells.item(0).textContent.replace(/\W/g, '').toLowerCase().trim();
        if( field.length == 0 ) continue;
        json[field] = row.cells.item(1).textContent.trim();
        if( json[field].length == 0 ){
            delete json[field];
            continue;
        }
        if(field == "descritores") json[field] = json[field].split("\n")
    }
    await con.index({
        id: link,
        index: INDEX_NAME,
        body: json
    }).catch(e => log(`index(${link}): ${JSON.stringify(e)}`))
})
.catch(e => {
    log(e.stack)
})
*/





async function forEachCourtDecisionLink( fn ){
    let visited = {}
    let start = 1;
    let currurl = link;
    while( true ){
        let page = await getPage(currurl);
        let anchorList = Array.from(page.window.document.querySelectorAll("a"))
        let next = anchorList.find( l => l.textContent == "Seguinte" ).href
        let courtList = anchorList.map(a => a.href).filter(u => u.match(/http:\/\/www\.dgsi\.pt\/(?<trib_acor>.*)\.nsf\/(?<hashsjt>.*)\/(?<hashid>.*)\?OpenDocument/))
        for( let decision of courtList ){
            if( decision in visited ) continue;
            visited[decision] = true
            await fn(decision);
        }
        if( next == currurl ){
            break;
        }
        currurl = next
    }
    log(`TERMINATED: Added ${count} entries`)
}