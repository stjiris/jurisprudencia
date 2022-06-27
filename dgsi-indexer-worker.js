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

const IGNORE_KEYS = ["", "1"]

forEachCourtDecisionLink(async link => {
    let table = await url2table(link+'&ExpandSection=1');
    
    try{
        let processo = table.Processo.textContent.trim().replace(/\s-\s.*$/, "").replace(/ver\s.*/, "");
        if( await indexer.exists({"Tribunal": Tribunal,"Processo": processo, "Origem": Origem}) ){
            return;
        }
        let year = 0;

        let body = {
            "Tribunal": Tribunal,
            "Código Tribunal": TribunalCode,
            "Tipo": "Acórdão",
            "Original URL": link,
            "Jurisprudência": "unknown",
            "Origem": Origem
        }
        // Add extra keys
        for( let key in table ){
            if( IGNORE_KEYS.indexOf(key) > -1 ){
                continue;
            }
            else if( key == "Descritores" ){
                body["Descritores"] = getDescritores(table)
            }
            else if( key.startsWith("Data") ){
                body[key] = table[key].textContent.trim().replace(/-/g, '/');
                if( !year ){
                    year = parseInt(body[key].split('/')[2]);
                }
            }
            else if( !(key in body) && !key.match(/Acórdãos \w+/) ){
                if( key in indexer.mapping.mappings.properties ){
                    body[key] = table[key].textContent.trim();
                }
                else{
                    body[key] = strip_empty_html_and_remove_font_tag(table[key].innerHTML);
                }
            }
        }
        if( TribunalCode == "STJ" && body["Nº Convencional"] && body["Nº Convencional"].match(/SEC/) ){
            body["Secção"] = table["Nº Convencional"].textContent.trim();
        }
        body["ECLI"] = builder.setNumber(processo).setYear(year).build();

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