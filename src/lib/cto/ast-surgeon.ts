import { Project, SourceFile } from "ts-morph";
import path from "path";
import fs from "fs";

const ROOT = process.cwd();

export function getProject(): Project {
  return new Project({
    tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: false,
  });
}

export function readFileContent(filePath: string): string {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  return fs.readFileSync(absPath, "utf-8");
}

export function writeFileContent(filePath: string, content: string): void {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
}

export function addImportIfMissing(
  sourceFile: SourceFile,
  namedImport: string,
  moduleSpecifier: string
): void {
  const existing = sourceFile.getImportDeclaration(moduleSpecifier);
  if (existing) {
    const named = existing.getNamedImports().map((n) => n.getName());
    if (!named.includes(namedImport)) existing.addNamedImport(namedImport);
  } else {
    sourceFile.addImportDeclaration({ namedImports: [namedImport], moduleSpecifier });
  }
}

export function upsertExportedFunction(
  sourceFile: SourceFile,
  name: string,
  body: string,
  isAsync = true
): void {
  const existing = sourceFile.getFunction(name);
  if (existing) existing.remove();
  sourceFile.addFunction({ name, isAsync, isExported: true, statements: body });
}

export function upsertInterfaceProperty(
  sourceFile: SourceFile,
  interfaceName: string,
  propertyName: string,
  propertyType: string,
  optional = false
): void {
  const iface = sourceFile.getInterface(interfaceName);
  if (!iface) throw new Error(`Interface "${interfaceName}" not found.`);
  const existing = iface.getProperty(propertyName);
  if (existing) {
    existing.setType(propertyType);
    existing.setHasQuestionToken(optional);
  } else {
    iface.addProperty({ name: propertyName, type: propertyType, hasQuestionToken: optional });
  }
}

export function getTypeErrors(project: Project): string[] {
  return project.getPreEmitDiagnostics().map((d) => {
    const file = d.getSourceFile();
    const loc = file ? ` [${file.getFilePath()}:${d.getLineNumber()}]` : "";
    return `${d.getMessageText()}${loc}`;
  });
}
