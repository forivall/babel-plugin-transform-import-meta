import { smart } from '@babel/template';
import type { PluginObj, NodePath, ConfigAPI, PluginPass } from '@babel/core';
import type { Statement, MemberExpression, Program, Node } from '@babel/types';
import type { VisitNodeFunction } from '@babel/traverse';

export interface PluginOptions {
  module?: 'CommonJS' | 'ES6' | undefined
  phase?: 'enter' | 'exit'
}

type PluginVisitNodeFunction<P extends Node> = VisitNodeFunction<PluginPass, P>;

/**
 * Rewrites known `import.meta`[1] properties into equivalent non-module node.js
 * expressions. In order to maintain compatibility with plugins transforming
 * non-standard properties, this plugin transforms only known properties and
 * does not touch expressions with unknown or without member property access.
 * Properties known to this plugin:
 *
 * - `url`[2]
 *
 * [1]: https://github.com/tc39/proposal-import-meta
 * [2]: https://html.spec.whatwg.org/#hostgetimportmetaproperties
 */
export default function (_api: ConfigAPI, options: PluginOptions): PluginObj {
  const { module: target = 'CommonJS', phase = 'enter' } = options ?? {};
  if (target !== 'CommonJS' && target !== 'ES6') {
    throw new Error('Invalid target, must be one of: "CommonJS" or "ES6"');
  }
  if (phase !== 'enter' && phase !== 'exit') {
    throw new Error('Invalid phase, must be one of: "enter" or "exit"');
  }
  const visitProgram: PluginVisitNodeFunction<Program> = (path, state) => {
    const metas: Array<NodePath<MemberExpression>> = [];
    const identifiers = new Set<string>();

    path.traverse({
      MemberExpression (memberExpPath) {
        const { node } = memberExpPath;

        if (
          node.object.type === 'MetaProperty' &&
              node.object.meta.name === 'import' &&
              node.object.property.name === 'meta' &&
              node.property.type === 'Identifier' &&
              node.property.name === 'url'
        ) {
          metas.push(memberExpPath);
          for (const name of Object.keys(memberExpPath.scope.getAllBindings())) {
            identifiers.add(name);
          }
        }
      }
    });

    if (metas.length === 0) {
      return;
    }

    let metaUrlReplacement: Statement;

    switch (target) {
      case 'CommonJS': {
        metaUrlReplacement = smart.ast`require('url').pathToFileURL(__filename).toString()` as Statement;
        break;
      }
      case 'ES6': {
        let urlId = 'url';

        while (identifiers.has(urlId)) {
          urlId = path.scope.generateUidIdentifier('url').name;
        }

        path.node.body.unshift(smart.ast`import ${urlId} from 'url';` as Statement);
        metaUrlReplacement = smart.ast`${urlId}.pathToFileURL(__filename).toString()` as Statement;
        break;
      }
    }

    for (const meta of metas) {
      meta.replaceWith(metaUrlReplacement);
    }
  };
  return {
    name: 'transform-import-meta',

    visitor: {
      Program: { [phase]: visitProgram }
    }
  };
}
