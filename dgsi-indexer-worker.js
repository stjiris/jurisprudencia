const { JSDOM } = require("jsdom");
const { workerData } = require("worker_threads");
const ECLI = require('./util/ecli');
const indexer = require('./indexer');
const url2table = require('./url-to-table');
const { strip_empty_html } = require('./util/html');
const fetch = require('./util/fetch');

let count = 0;

const { Tribunal, TribunalCode, link } = workerData;
const log = (msg) => console.log(`[WORKER ${TribunalCode}] ${msg}`)
log(`${link} - ${Tribunal}`);
let builder = new ECLI().setCountry("PT").setJurisdiction(TribunalCode).setYear("0000");
const Origem = `dgsi-indexer-${TribunalCode}`;

const IGNORE_KEYS = ["", "1", "Texto Integral", "Decisão Texto Integral", "Decisão", "Nº Convencional", "Privacidade", "Nº do Documento"]

forEachCourtDecisionLink(async link => {
    let table = await url2table(link+'&ExpandSection=1');
    
    let processo = table.Processo.textContent.trim().replace(/\s-\s.*$/, "").replace(/ver\s.*/, "");
    if( await indexer.exists({"Tribunal": Tribunal,"Processo": processo, "Origem": Origem}) ){
        return;
    }
    try{
        let Data = getData(table).replace(/-/g, '/');
        let datePT = Data;
        let year = Data.match(/(\d{4})$/)[1];

        let body = {
            "ECLI": builder.setYear(year).setNumber(processo).build(),
            "Tribunal": Tribunal,
            "Processo": processo,
            "Relator": table.Relator.textContent.trim(),
            "Data": datePT,
            "Descritores": getDescritores(table),
            "Sumário": getSumario(table),
            "Texto": getTexto(table),
            "Tipo": "Acórdão",
            "Original URL": link,
            "Votação": getFirst(table, ["Votação"], link),
            "Meio Processual": getFirst(table, ["Meio Processual"], link),
            "Secção": getFirst(table, ["Tribunal", "Secção", "Nº Convencional"], link), // STA tem tribunal (secção) e Nº convecional 
            "Espécie": getFirst(table, ["Espécie"], link),
            "Decisão": getDecisao(table),
            "Aditamento": getFirst(table, ["Aditamento"], link),
            "Jurisprudência": "unknown",
            "Origem": Origem
        }
        // Add extra keys
        for( let key in table ){
            if( IGNORE_KEYS.indexOf(key) > -1 ){
                continue;
            }
            else if( key.startsWith("Data") ){
                body[key] = table[key].textContent.trim().replace(/-/g, '/');
            }
            else if( !(key in body) && !key.match(/Acórdãos \w+/) ){
                body[key] = table[key].textContent.trim();
            }
        }

        await indexer.index(body);
        count++;

    }
    catch(e){
        console.log(`Error: ${link}`)
        console.log(e.stack)
    }
})

function getDescritores(table){
    if( table.Descritores ){
        // TODO: handle , and ; in descritores (e.g. "Ação Civil; Ação Civil e Administrativa") however dont split some cases (e.g. "Art 321º, do código civil")
        return table.Descritores.textContent.trim().split(/\n|;/).map( desc => desc.trim().replace(/\.$/g,'').replace(/^(:|-|,|"|“|”|«|»|‘|’)/,'').trim() ).filter( desc => desc.length > 0 )
    }
    return []
}

function strip_empty_html_and_remove_font_tag(html){
    return strip_empty_html(html).replace(/<\/?font>/g, '')
}

function getTexto(table){
    if( "Decisão Texto Integral" in table ){
        return strip_empty_html_and_remove_font_tag(table["Decisão Texto Integral"].innerHTML)
    }
    if( "Texto Integral" in table ){
        return strip_empty_html_and_remove_font_tag(table["Texto Integral"].innerHTML)
    }
    return null;
}

function getSumario(table){
    if( "Sumário" in table ){
        return strip_empty_html_and_remove_font_tag(table["Sumário"].innerHTML)
    }
    return null;
}

function getDecisao(table){
    if( "Decisão" in table ){
        return strip_empty_html_and_remove_font_tag(table["Decisão"].innerHTML)
    }
    return null;
}

function getData(table){
    if( "Data do Acordão" in table ){
        return table["Data do Acordão"].textContent.trim();
    }
    if( "Data da Decisão Sumária" in table ){
        return table["Data da Decisão Sumária"].textContent.trim();
    }
    if( "Data da Reclamação" in table ){
        return table["Data da Reclamação"].textContent.trim();
    }
    return null;
}

function getFirst(table, keys, link){
    for( let key of keys ){
        if( key in table ){
            return table[key].textContent.trim();
        }
    }
    return null;
}

async function forEachCourtDecisionLink( fn ){
    let visited = {}
    let start = 1;
    let currurl = link;
    while( true ){
        let page = await fetch.dom(currurl);
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