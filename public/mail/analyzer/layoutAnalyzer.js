function analyzeLayout(html){

    const parser = new DOMParser();

    const doc =
        parser.parseFromString(html,"text/html");

    return{

        tables:
            doc.querySelectorAll("table").length,

        divs:
            doc.querySelectorAll("div").length,

        sections:
            doc.querySelectorAll("section").length,

        articles:
            doc.querySelectorAll("article").length,

        containers:
            doc.querySelectorAll("[class*=container]").length,

        bodyExists:
            !!doc.body

    };

}

window.analyzeLayout = analyzeLayout;