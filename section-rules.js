const jsdom = require("jsdom");

const SECÇÃO_KEY = "Nº Convencional";

const Secções = {
    SECÇÃO_1: "1.ª Secção (Cível)",
    SECÇÃO_2: "2.ª Secção (Cível)",
    SECÇÃO_3: "3.ª Secção (Criminal)",
    SECÇÃO_4: "4.ª Secção (Social)",
    SECÇÃO_5: "5.ª Secção (Criminal)",
    SECÇÃO_6: "6.ª Secção (Cível)",
    SECÇÃO_7: "7.ª Secção (Cível)",
    SECÇÃO_C: "Contencioso",
    SECÇÃO_NULL: "(sem secção registada)"
};

module.exports = function getSecçãoFromDocument(originalTable){
    if( !(SECÇÃO_KEY in originalTable) ) return getSectionFromDocumentNumber(originalTable);

    let possibleSecção = new jsdom.JSDOM(originalTable[SECÇÃO_KEY]).window.document.body.textContent.trim();

    if( possibleSecção.match(/Contencioso/i) ){
        return Secções.SECÇÃO_C;
    }

    if( possibleSecção.match(/se/i) && possibleSecção.match(/^(1|2|3|4|5|6|7)/) ){
        let number = possibleSecção[0];
        let key = `SECÇÃO_${number}`;
        return Secções[key]
    }

    // Ortografia - CONSTENCIOSO
    if( possibleSecção.match(/Constencioso/i) ){
        return Secções.SECÇÃO_C;
    }

    return getSectionFromDocumentNumber(originalTable);
}

module.exports.SECÇÕES = Secções;

function getSectionFromDocumentNumber(originalTable){
    if( !("Nº do Documento" in originalTable) ) return Secções.SECÇÃO_NULL;

    let possibleNum = new jsdom.JSDOM(originalTable["Nº do Documento"]).window.document.body.textContent.trim();
    if( !possibleNum.match(/(SJ)?\d+(1|2|3|4|5|6|7)$/) ){
        return Secções.SECÇÃO_NULL;
    }

    return Secções[`SECÇÃO_${possibleNum.slice(-1)}`];
}
