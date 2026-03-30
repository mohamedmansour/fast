import { RenderableFASTElement, TemplateElement } from "@microsoft/fast-html";
import { FASTElement, observable } from "@microsoft/fast-element";

class WhenObservableElement extends FASTElement {
    @observable
    workplaceJoined: boolean = true;
}
RenderableFASTElement(WhenObservableElement).defineAsync({
    name: "when-observable-element",
    templateOptions: "defer-and-hydrate",
});

TemplateElement.define({
    name: "f-template",
});
