import { namedTypes as t } from 'ast-types';
import getMemberValuePath from '../utils/getMemberValuePath';
import getMethodDocumentation from '../utils/getMethodDocumentation';
import isReactComponentClass from '../utils/isReactComponentClass';
import isReactComponentMethod from '../utils/isReactComponentMethod';
import type Documentation from '../Documentation';
import match from '../utils/match';
import { traverseShallow } from '../utils/traverse';
import resolveToValue from '../utils/resolveToValue';
import type { Importer } from '../parse';
import type { NodePath } from 'ast-types/lib/node-path';
import { Scope } from 'ast-types/lib/scope';

function isPublicClassProperty(path: NodePath): boolean {
  return (
    t.ClassProperty.check(path.node) && !t.ClassPrivateProperty.check(path.node)
  );
}
/**
 * The following values/constructs are considered methods:
 *
 * - Method declarations in classes (except "constructor" and React lifecycle
 *   methods
 * - Public class fields in classes whose value are a functions
 * - Object properties whose values are functions
 */
function isMethod(path: NodePath, importer: Importer): boolean {
  const isProbablyMethod =
    (t.MethodDefinition.check(path.node) && path.node.kind !== 'constructor') ||
    ((isPublicClassProperty(path) || t.Property.check(path.node)) &&
      t.Function.check(resolveToValue(path.get('value'), importer).node));

  return isProbablyMethod && !isReactComponentMethod(path, importer);
}

function findAssignedMethods(
  scope: Scope,
  idPath: NodePath,
  importer: Importer,
): NodePath[] {
  const results: NodePath[] = [];

  if (!t.Identifier.check(idPath.node)) {
    return results;
  }

  const name = idPath.node.name;
  const idScope = idPath.scope.lookup(idPath.node.name);

  traverseShallow(scope.path, {
    visitAssignmentExpression: function (path) {
      const node = path.node;
      if (
        match(node.left, {
          type: 'MemberExpression',
          object: { type: 'Identifier', name },
        }) &&
        path.scope.lookup(name) === idScope &&
        t.Function.check(resolveToValue(path.get('right'), importer).node)
      ) {
        results.push(path);
        return false;
      }
      return this.traverse(path);
    },
  });

  return results;
}

/**
 * Extract all flow types for the methods of a react component. Doesn't
 * return any react specific lifecycle methods.
 */
export default function componentMethodsHandler(
  documentation: Documentation,
  path: NodePath,
  importer: Importer,
): void {
  // Extract all methods from the class or object.
  let methodPaths: NodePath[] = [];
  if (isReactComponentClass(path, importer)) {
    methodPaths = path
      .get('body', 'body')
      .filter((body: NodePath) => isMethod(body, importer));
  } else if (t.ObjectExpression.check(path.node)) {
    methodPaths = path
      .get('properties')
      .filter((props: NodePath) => isMethod(props, importer));

    // Add the statics object properties.
    const statics = getMemberValuePath(path, 'statics', importer);
    if (statics) {
      statics.get('properties').each((p: NodePath) => {
        if (isMethod(p, importer)) {
          p.node.static = true;
          methodPaths.push(p);
        }
      });
    }
  } else if (
    t.VariableDeclarator.check(path.parent.node) &&
    path.parent.node.init === path.node &&
    t.Identifier.check(path.parent.node.id)
  ) {
    methodPaths = findAssignedMethods(
      path.parent.scope,
      path.parent.get('id'),
      importer,
    );
  } else if (
    t.AssignmentExpression.check(path.parent.node) &&
    path.parent.node.right === path.node &&
    t.Identifier.check(path.parent.node.left)
  ) {
    methodPaths = findAssignedMethods(
      path.parent.scope,
      path.parent.get('left'),
      importer,
    );
  } else if (t.FunctionDeclaration.check(path.node)) {
    methodPaths = findAssignedMethods(
      path.parent.scope,
      path.get('id'),
      importer,
    );
  }

  documentation.set(
    'methods',
    methodPaths.map(p => getMethodDocumentation(p, importer)).filter(Boolean),
  );
}
