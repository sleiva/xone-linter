import type { SourceLocation } from '../model/XoneModel.js';

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  file?: string;
  location?: SourceLocation;
}

export class ValidationResult {
  issues: ValidationIssue[] = [];

  add(severity: Severity, code: string, message: string, file?: string, location?: SourceLocation): void {
    this.issues.push({ severity, code, message, file, location });
  }

  error(code: string, message: string, file?: string, location?: SourceLocation): void {
    this.add('error', code, message, file, location);
  }

  warning(code: string, message: string, file?: string, location?: SourceLocation): void {
    this.add('warning', code, message, file, location);
  }

  info(code: string, message: string, file?: string, location?: SourceLocation): void {
    this.add('info', code, message, file, location);
  }

  get errors(): ValidationIssue[] {
    return this.issues.filter(i => i.severity === 'error');
  }

  get warnings(): ValidationIssue[] {
    return this.issues.filter(i => i.severity === 'warning');
  }

  get hasErrors(): boolean {
    return this.errors.length > 0;
  }

  merge(other: ValidationResult): void {
    this.issues.push(...other.issues);
  }
}
