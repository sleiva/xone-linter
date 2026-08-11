import type { XoneProjectModel } from '../model/XoneModel.js';
import { ValidationResult } from './ValidationResult.js';
import { XmlWellFormedRule } from './rules/XmlWellFormedRule.js';
import { CollShapeRule } from './rules/CollShapeRule.js';
import { RequiredAttributesRule } from './rules/RequiredAttributesRule.js';
import { UniqueNamesRule } from './rules/UniqueNamesRule.js';
import { PropTypeRule } from './rules/PropTypeRule.js';
import { ProgidRule } from './rules/ProgidRule.js';
import { IncludeExistsRule } from './rules/IncludeExistsRule.js';
import { JsSyntaxRule } from './rules/JsSyntaxRule.js';
import { CrossReferenceRule } from './rules/CrossReferenceRule.js';
import { AntiPatternRule } from './rules/AntiPatternRule.js';
import { HandlerReferenceRule } from './rules/HandlerReferenceRule.js';

export interface ValidationRule {
  name: string;
  validate(project: XoneProjectModel, result: ValidationResult): void | Promise<void>;
}

export class Validator {
  private readonly rules: ValidationRule[];

  constructor(opts?: { rules?: ValidationRule[] }) {
    this.rules = opts?.rules ?? [
      new XmlWellFormedRule(),
      new CollShapeRule(),
      new RequiredAttributesRule(),
      new UniqueNamesRule(),
      new PropTypeRule(),
      new ProgidRule(),
      new IncludeExistsRule(),
      new JsSyntaxRule(),
      new CrossReferenceRule(),
      new AntiPatternRule(),
      new HandlerReferenceRule(),
    ];
  }

  /** Nombres de las reglas del pipeline, en orden. Lo usa el test que fija la partición entre
   *  reglas locales (las que corre `validateCollFile`) y reglas de sólo-proyecto: si se añade una
   *  regla al pipeline sin clasificarla, ese test se pone rojo. */
  get ruleNames(): string[] {
    return this.rules.map(r => r.name);
  }

  async validate(project: XoneProjectModel): Promise<ValidationResult> {
    const result = new ValidationResult();
    for (const rule of this.rules) {
      await rule.validate(project, result);
    }
    return result;
  }
}
