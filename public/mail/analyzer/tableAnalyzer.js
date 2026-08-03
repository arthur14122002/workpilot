function analyzeTables(html){

    const parser =
        new DOMParser();

    const doc =
        parser.parseFromString(html,"text/html");

    return{

        tables:
            doc.querySelectorAll("table").length,

        rows:
            doc.querySelectorAll("tr").length,

        cells:
            doc.querySelectorAll("td").length,

        nestedTables:
            doc.querySelectorAll("table table").length,

        colspans:
            doc.querySelectorAll("[colspan]").length,

        rowspans:
            doc.querySelectorAll("[rowspan]").length

    };

}

window.analyzeTables = analyzeTables;