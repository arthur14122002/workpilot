class MailDom {

    constructor(html = "") {

        this.originalHtml = html || "";

        this.parser = new DOMParser();

        this.document = this.parser.parseFromString(
            this.originalHtml,
            "text/html"
        );

    }

    getDocument() {

        return this.document;

    }

    getBody() {

        return this.document.body;

    }

    getHead() {

        return this.document.head;

    }

    query(selector) {

        return this.document.querySelector(selector);

    }

    queryAll(selector) {

        return Array.from(
            this.document.querySelectorAll(selector)
        );

    }

    create(tagName) {

        return this.document.createElement(tagName);

    }

    remove(element) {

        if (!element) {
            return;
        }

        element.remove();

    }

    replace(oldElement, newElement) {

        if (!oldElement || !newElement) {
            return;
        }

        oldElement.replaceWith(newElement);

    }

    append(parent, child) {

        if (!parent || !child) {
            return;
        }

        parent.appendChild(child);

    }

    prepend(parent, child) {

        if (!parent || !child) {
            return;
        }

        parent.prepend(child);

    }

    html() {

        return this.document.documentElement.outerHTML;

    }

    serialize() {

        return "<!DOCTYPE html>\n" +
            this.document.documentElement.outerHTML;

    }

}

window.MailDom = MailDom;