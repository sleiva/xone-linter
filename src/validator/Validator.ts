import type { XoneProjectModel } from '../model/XoneModel.js';
import { ValidationResult } from './ValidationResult.js';
import { XmlWellFormedRule } from './rules/XmlWellFormedRule.js';
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

  constructor() {
    this.rules = [
      new XmlWellFormedRule(),
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

  async validate(project: XoneProjectModel): Promise<ValidationResult> {
    const result = new ValidationResult();
    for (const rule of this.rules) {
      await rule.validate(project, result);
    }
    return result;
  }
}
