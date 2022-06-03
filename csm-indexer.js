const getUrl = (off=0, pp=100) => `https://jurisprudencia.csm.org.pt/items/loadItems?sorts%5BdataAcordao%5D=1&perPage=${pp}&offset=${off}`
const ECLI = require('./util/ecli');
const { init, index, exists, mapping } = require('./indexer');
const fetch = require('./util/fetch');
const url2Table = require('./url-to-table');
const { strip_empty_html } = require('./util/html');

const name2code = {
    "Supremo Tribunal de Justiça": "STJ",
    "Tribunal da Relação de Coimbra": "TRC",
    "Tribunal da Relação de Évora": "TRE",
    "Tribunal da Relação de Guimarães": "TRG",
    "Tribunal da Relação de Lisboa": "TRL",
    "Tribunal da Relação do Porto": "TRP",
    "Tribunal da Propriedade Intelectual": "TPI",
    "Tribunal da Concorrência, Regulação e Supervisão": "TCR",
    "Supremo Tribunal Administrativo": "STA",
    "Tribunal Central Administrativo Sul": "TCA",
    "Tribunal Central Administrativo Norte": "TCN",
    "Tribunal de Conflitos": "CON",
    "Acórdãos do Tribunal Constitucional": "TCO"
}

const name2name = {
    "Supremo Tribunal de Justiça": "Supremo Tribunal de Justiça",
    "Tribunal da Relação de Coimbra": "Tribunal da Relação de Coimbra",
    "Tribunal da Relação de Évora": "Tribunal da Relação de Évora",
    "Tribunal da Relação de Guimarães": "Tribunal da Relação de Guimarães",
    "Tribunal da Relação de Lisboa": "Tribunal da Relação de Lisboa",
    "Tribunal da Relação do Porto": "Tribunal da Relação do Porto",
    "Tribunal da Propriedade Intelectual": "Tribunal da Propriedade Intelectual",
    "Tribunal da Concorrência, Regulação e Supervisão": "Tribunal da Concorrência, Regulação e Supervisão",
    "Supremo Tribunal Administrativo": "Supremo Tribunal Administrativo",
    "Tribunal Central Administrativo Sul": "Tribunal Central Administrativo Sul",
    "Tribunal Central Administrativo Norte": "Tribunal Central Administrativo Norte",
    "Tribunal de Conflitos": "Tribunal dos Conflitos",
    "Acórdãos do Tribunal Constitucional": "Tribunal Constitucional"
}

init().then( async _ => forEachCSMRecord(async record => {
    let Tribunal = record.tribunal;
    let Code = name2code[Tribunal];

    let ecli = ECLI.fromString(record.ecli.replace(/ver\.ac\..*(\.\w{2})/,"$1")).setJurisdiction(Code);
    let link = `https://jurisprudencia.csm.org.pt/ecli/${record.ecli}/`;
    let table = await url2Table(`https://jurisprudencia.csm.org.pt/ecli/${record.ecli}/`);
    
    let processo = table.Processo.textContent.trim().replace(/\s-\s.*$/, "").replace(/ver\s.*/, "");
    if( await exists({"Tribunal": Tribunal,"Processo": processo, "Origem": "csm-indexer"}) ){
        return;
    }
    try{
        year = 0;
        let body = {
            "Tribunal": Tribunal,
            "Código Tribunal": Code,
            "Tipo": "Acordão",
            "Original URL": link,
            "Jurisprudência": "unknown",
            "Origem": "csm-indexer"
        };
        
        // Add extra keys
        for( let key in table ){
            if( key.startsWith("Data") ){
                body[key] = table[key].textContent.trim().replace(/-/g, '/');
                if( !year ){
                    year = parseInt(body[key].split('/')[2]);
                }
            }
            else if( key == "Descritores" ){
                body[key] = table[key].textContent.trim().split("\n");
            }
            else if( !(key in body) && !key.match(/Acórdãos \w+/) ){
                if( key in mapping.mappings.properties ){
                    body[key] = table[key].textContent.trim();
                }
                else{
                    body[key] = strip_empty_html_and_remove_font_tag(table[key].innerHTML);
                }
            }
        }

        body["ECLI"] = ecli.setYear(year).setJurisdiction(Code).setNumber(body["Processo"]).toString();
        if( body["ECLI"] != record.ecli ){
            body["_UNMATCHING_ECLI"] = record.ecli;
        }

        await index(body);
    }
    catch(e){
        console.log(link, e);
    }
}));


async function forEachCSMRecord(fn){
    let offset = 0;
    if( "START_OFFSET" in process.env ){
        offset = parseInt(process.env.START_OFFSET);
        if( Number.isNaN(offset) ){
            offset = 0;
            console.log("Invalid START_OFFSET, using 0");
        }
    }
    let perPage = 500;
    let url = getUrl(offset, perPage);
    while(true){
        let { records, queryRecordCount } = await fetch.json(url).catch(e => ({records: [], queryRecordCount: 0}));
        console.log(offset,"/", queryRecordCount);
        for(let r of records){
            await fn(r);
        }
        offset += records.length;
        if(offset >= queryRecordCount) break;
        url = getUrl(offset, perPage);
        if( records.length == 0 ) {
            console.log("Sleeping...");
            await new Promise(resolve => setTimeout(resolve, 30*60*1000)); // 30 minutes
        };
    }
}

console.log("Starting...");

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
