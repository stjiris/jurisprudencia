const url2table = require('./url-to-table');
const es = require('@elastic/elasticsearch')
const client = new es.Client({ node: 'http://localhost:9200' });
const DGSI_LINK = "http://www.dgsi.pt/jstj.nsf?OpenDatabase";
const DGSI_PATTERN = /http:\/\/www\.dgsi\.pt\/jstj\.nsf\/(?<hashsjt>.*)\/(?<hashid>.*)\?OpenDocument/;
const jurisprudencia = require('./jurisprudencia');
const fetch = require('./util/fetch');
const { strip_attrs } = require('./util/html');

forEachDgsiLink(async url => {
    if( await UrlIsIndexed(url) ){
        console.log(`${url} already indexed`)
        return;
    }
    let table = await url2table(url);
    let original = {}
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
            tipo = key.match(/Data d. (.*)/)[1];
            data = table[key].textContent.trim().replace(/-/g, '/');
        }
    });
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
        "Decisão": strip_attrs(table["Decisão"]?.innerHTML || ""),
        "Sumário": strip_attrs(table["Sumário"]?.innerHTML || ""),
        "Texto": strip_attrs(table["Decisão Texto Integral"]?.innerHTML || ""),
        "URL": url
    }
    await client.index({
        index: jurisprudencia.Index,
        body: object
    });
})

function getDescritores(table){
    if( table.Descritores ){
        // TODO: handle , and ; in descritores (e.g. "Ação Civil; Ação Civil e Administrativa") however dont split some cases (e.g. "Art 321º, do código civil")
        return table.Descritores.textContent.trim().split(/\n|;/).map( desc => desc.trim().replace(/\.$/g,'').replace(/^(:|-|,|"|“|”|«|»|‘|’)/,'').trim() ).filter( desc => desc.length > 0 )
    }
    return []
}

function getMeioProcessual(table){
    if( table.MeioProcessual ){
        return table.MeioProcessual.textContent.trim();
    }
    return null;
}

function getVotação(table){
    if( table.Votação ){
        let text = table.Votação.textContent.trim();
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

async function UrlIsIndexed( url ){
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