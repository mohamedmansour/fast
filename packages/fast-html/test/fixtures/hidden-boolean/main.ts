import { RenderableFASTElement, TemplateElement } from "@microsoft/fast-html";
import { FASTElement, observable } from "@microsoft/fast-element";

class HiddenBooleanElement extends FASTElement {
    @observable
    showContent: boolean = true;
}
RenderableFASTElement(HiddenBooleanElement).defineAsync({
    name: "hidden-boolean-element",
    templateOptions: "defer-and-hydrate",
});

TemplateElement.define({
    name: "f-template",
});
