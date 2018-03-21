import * as ts from 'typescript';

abstract class Visitor {
  protected context: ts.TransformationContext;

  constructor(context: ts.TransformationContext) {
    this.context = context;
  }

  abstract visit(node: ts.Node): ts.VisitResult<ts.Node>;
}

abstract class DecoratorVisitor<T extends ts.Node> extends Visitor {
  protected abstract kinds: string[];

  constructor(context: ts.TransformationContext) {
    super(context);
  }

  visit(node: ts.Node): ts.VisitResult<ts.Node> {
    if (this.isValidNode(node) && node.decorators) {
      const decorators = node.decorators;

      const decorator = decorators.find(
          (d) => this.kinds.indexOf(this.getDecoratorName(d)) !== -1);

      if (!decorator) {
        return node;
      }

      node.decorators = this.removeDecorators(node.decorators, this.kinds);

      return this.applyDecorator(decorator, node);
    }

    return ts.visitEachChild(node, (child) => this.visit(child), this.context);
  }

  protected removeDecorators(
      decorators: ts.NodeArray<ts.Decorator>,
      names: string[]): ts.NodeArray<ts.Decorator>|undefined {
    const newDecorators = decorators.filter(
        (decorator) => names.indexOf(this.getDecoratorName(decorator)) === -1);

    if (newDecorators.length === 0 && decorators.length !== 0) {
      return undefined;
    }

    if (decorators.length !== newDecorators.length) {
      return ts.createNodeArray(newDecorators);
    }

    return decorators;
  }

  protected getDecoratorName(decorator: ts.Decorator): string {
    if (ts.isCallExpression(decorator.expression)) {
      return decorator.expression.expression.getText();
    }
    return decorator.expression.getText();
  }

  protected getDecoratorArguments(decorator: ts.Decorator): ts.Expression[] {
    if (ts.isCallExpression(decorator.expression)) {
      return [...decorator.expression.arguments];
    }
    return [];
  }

  protected abstract isValidNode(node: ts.Node): node is T;

  protected abstract applyDecorator(decorator: ts.Decorator, node: T): T;
}

class CustomElementVisitor extends DecoratorVisitor<ts.ClassDeclaration> {
  protected kinds = ['Polymer.decorators.customElement', 'customElement'];

  constructor(context: ts.TransformationContext) {
    super(context);
  }

  isValidNode(node: ts.Node): node is ts.ClassDeclaration {
    return ts.isClassDeclaration(node);
  }

  applyDecorator(decorator: ts.Decorator, node: ts.ClassDeclaration) {
    const members = node.members;
    const isProperty: ts.PropertyDeclaration|undefined =
        members.find<ts.PropertyDeclaration>(
            (m): m is ts.PropertyDeclaration =>
                ts.isPropertyDeclaration(m) && m.name.getText() === 'is');
    const isAccessor: ts.GetAccessorDeclaration|undefined =
        members.find<ts.GetAccessorDeclaration>(
            (m): m is ts.GetAccessorDeclaration =>
                ts.isGetAccessor(m) && m.name.getText() === 'is');
    const args = this.getDecoratorArguments(decorator);
    let tagName: string|null = null;

    if (isProperty) {
      if (isProperty.initializer) {
        tagName = isProperty.initializer.getText();
      }
    } else if (isAccessor) {
      if (isAccessor.body) {
        const returnStatement =
            isAccessor.body.statements.find<ts.ReturnStatement>(
                (statement): statement is ts.ReturnStatement =>
                    ts.isReturnStatement(statement));

        if (returnStatement && returnStatement.expression) {
          tagName = returnStatement.expression.getText();
        }
      }
    } else {
      if (args.length === 0) {
        // TODO: should error
        return node;
      }

      tagName = args[0].getText();

      const newGetter = ts.createGetAccessor(
          undefined,
          [ts.createToken(ts.SyntaxKind.StaticKeyword)],
          'is',
          [],
          undefined,
          ts.createBlock([ts.createReturn(args[0])]));

      node.members = ts.createNodeArray([newGetter, ...members]);
    }

    console.log(tagName);

    return node;
  }
}

/*
  customElementVisitor,
  propertyVisitor,
  observeVisitor,
  computedVisitor,
  listenVisitor,
  queryVisitor,
  queryAllVisitor
*/

export function decoratorTransformer(): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    const visitors = [new CustomElementVisitor(context)];

    const visit: ts.Visitor = (node) => {
      for (const visitor of visitors) {
        visitor.visit(node);
      }
      return node;
    };

    return (node) => ts.visitNode(node, visit);
  };
}

let source = `
@customElement('x-foo')
class XFoo extends HTMLElement {
}
`;
let result = ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS},
  transformers: {before: [decoratorTransformer()]}
});

console.log(result.outputText);
