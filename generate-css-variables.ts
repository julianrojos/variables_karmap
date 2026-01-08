import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Convierte un nombre a kebab-case
 */
function toKebabCase(name: string): string {
  // Reemplaza guiones existentes con espacios temporales
  let result = name.replace(/-/g, ' ');
  
  // Inserta guiones antes de mayúsculas (excepto al inicio)
  result = result.replace(/([a-z])([A-Z])/g, '$1-$2');
  
  // Convierte a minúsculas
  result = result.toLowerCase();
  
  // Reemplaza espacios y guiones múltiples con un solo guión
  result = result.replace(/[\s-]+/g, '-');
  
  // Elimina guiones al inicio y final
  result = result.replace(/^-+|-+$/g, '');
  
  return result;
}

/**
 * Procesa el valor según su tipo
 */
function processValue(value: string, varType: string): string {
  // Si es una referencia a otro token, la mantenemos como referencia
  if (value.startsWith('{') && value.endsWith('}')) {
    return value;
  }
  
  // Si es un color rgba, lo mantenemos
  if (value.startsWith('rgba')) {
    return value;
  }
  
  // Si es un string, lo envolvemos en comillas
  if (varType === 'string') {
    return `"${value}"`;
  }
  
  return value;
}

/**
 * Genera variables CSS recursivamente desde el objeto JSON
 */
function generateCssVars(
  obj: any,
  prefix: string = '',
  result: string[] = []
): string[] {
  if (typeof obj !== 'object' || obj === null) {
    return result;
  }

  for (const key in obj) {
    // Ignorar propiedades que empiezan con $
    if (key.startsWith('$')) {
      continue;
    }

    const newPrefix = prefix
      ? `${prefix}-${toKebabCase(key)}`
      : toKebabCase(key);

    const value = obj[key];

    if (typeof value === 'object' && value !== null) {
      // Si tiene $value, es una variable final
      if ('$value' in value) {
        const varValue = processValue(
          value.$value,
          value.$type || ''
        );
        const varName = `--${newPrefix}`;
        result.push(`  ${varName}: ${varValue};`);
      } else {
        // Es un objeto anidado, continuar recursivamente
        generateCssVars(value, newPrefix, result);
      }
    } else {
      // Valor primitivo
      const varName = `--${newPrefix}`;
      result.push(`  ${varName}: ${value};`);
    }
  }

  return result;
}

/**
 * Extrae los nombres y valores de las variables CSS de un archivo CSS
 */
function extractCssVariables(cssContent: string): Map<string, string> {
  const variables = new Map<string, string>();
  const regex = /--([a-z0-9-]+):\s*([^;]+);/g;
  let match;
  
  while ((match = regex.exec(cssContent)) !== null) {
    const name = match[1];
    const value = match[2].trim();
    variables.set(name, value);
  }
  
  return variables;
}

/**
 * Función principal
 */
function main(): void {
  try {
    const jsonPath = join(process.cwd(), 'variables.json');
    const cssPath = join(process.cwd(), 'variables.css');

    console.log('📖 Leyendo variables.json...');
    const fileContent = readFileSync(jsonPath, 'utf-8');

    // Leer el archivo CSS anterior si existe para comparar
    let previousVariables: Map<string, string> = new Map();
    if (existsSync(cssPath)) {
      try {
        const previousCss = readFileSync(cssPath, 'utf-8');
        previousVariables = extractCssVariables(previousCss);
        console.log(`📄 Archivo CSS anterior encontrado con ${previousVariables.size} variables`);
      } catch (error) {
        console.log('⚠️  No se pudo leer el archivo CSS anterior (se creará uno nuevo)');
      }
    }

    // Parsear JSON
    let data: any;
    try {
      data = JSON.parse(fileContent);
    } catch (error) {
      // Si falla, intentar extraer solo la parte de Tokens
      const translationStart = fileContent.indexOf('"Translations"');
      if (translationStart > 0) {
        // Buscar el inicio del objeto (primera llave {)
        const firstBrace = fileContent.indexOf('{');
        const jsonContent = fileContent
          .substring(firstBrace, translationStart)
          .trim()
          .replace(/,\s*$/, '');
        
        // Asegurarse de que termine con }
        const cleanedContent = jsonContent.endsWith('}')
          ? jsonContent
          : `${jsonContent}\n}`;
        
        try {
          data = JSON.parse(cleanedContent);
        } catch (parseError) {
          console.error('❌ No se pudo parsear el JSON incluso después de limpiarlo');
          throw parseError;
        }
      } else {
        // Si no hay Translations, intentar parsear directamente
        // Puede que el JSON esté mal formado, intentar arreglarlo
        let cleaned = fileContent.trim();
        if (!cleaned.startsWith('{')) {
          cleaned = `{${cleaned}`;
        }
        if (!cleaned.endsWith('}')) {
          cleaned = `${cleaned}}`;
        }
        try {
          data = JSON.parse(cleaned);
        } catch {
          throw error;
        }
      }
    }

    // Extraer solo Tokens (excluir Translations si existe)
    let tokensData = data;
    if ('Tokens' in data && typeof data.Tokens === 'object') {
      tokensData = data.Tokens;
    }
    if ('Translations' in tokensData) {
      delete tokensData.Translations;
    }

    console.log('🔄 Generando variables CSS desde variables.json...');
    const cssVars = generateCssVars(tokensData);

    // Extraer nombres y valores de variables nuevas
    const newVariables = new Map<string, string>();
    cssVars.forEach(line => {
      const match = line.match(/--([a-z0-9-]+):\s*([^;]+);/);
      if (match) {
        const name = match[1];
        const value = match[2].trim();
        newVariables.set(name, value);
      }
    });

    // Crear el contenido CSS completamente nuevo (sobrescribe el anterior)
    const cssContent = `:root {\n${cssVars.join('\n')}\n}\n`;

    // Escribir el archivo (sobrescribe completamente)
    writeFileSync(cssPath, cssContent, 'utf-8');

    // Mostrar resumen de cambios
    console.log(`\n✅ Archivo variables.css regenerado completamente`);
    console.log(`   📊 Total de variables: ${cssVars.length}`);
    
    if (previousVariables.size > 0) {
      // Encontrar variables eliminadas
      const removedVariables: string[] = [];
      previousVariables.forEach((value, name) => {
        if (!newVariables.has(name)) {
          removedVariables.push(name);
        }
      });
      
      // Encontrar variables nuevas
      const addedVariables: string[] = [];
      newVariables.forEach((value, name) => {
        if (!previousVariables.has(name)) {
          addedVariables.push(name);
        }
      });
      
      // Encontrar variables modificadas (mismo nombre, diferente valor)
      const modifiedVariables: Array<{ name: string; oldValue: string; newValue: string }> = [];
      newVariables.forEach((newValue, name) => {
        if (previousVariables.has(name)) {
          const oldValue = previousVariables.get(name)!;
          if (oldValue !== newValue) {
            modifiedVariables.push({ name, oldValue, newValue });
          }
        }
      });
      
      if (removedVariables.length > 0) {
        console.log(`   🗑️  Variables eliminadas: ${removedVariables.length}`);
        if (removedVariables.length <= 10) {
          removedVariables.forEach(name => {
            console.log(`      - --${name}`);
          });
        } else {
          removedVariables.slice(0, 10).forEach(name => {
            console.log(`      - --${name}`);
          });
          console.log(`      ... y ${removedVariables.length - 10} más`);
        }
      }
      
      if (addedVariables.length > 0) {
        console.log(`   ➕ Variables añadidas: ${addedVariables.length}`);
        if (addedVariables.length <= 10) {
          addedVariables.forEach(name => {
            console.log(`      + --${name}`);
          });
        } else {
          addedVariables.slice(0, 10).forEach(name => {
            console.log(`      + --${name}`);
          });
          console.log(`      ... y ${addedVariables.length - 10} más`);
        }
      }
      
      if (modifiedVariables.length > 0) {
        console.log(`   🔄 Variables modificadas: ${modifiedVariables.length}`);
        if (modifiedVariables.length <= 10) {
          modifiedVariables.forEach(({ name, oldValue, newValue }) => {
            console.log(`      ~ --${name}`);
            console.log(`        Antes: ${oldValue}`);
            console.log(`        Ahora: ${newValue}`);
          });
        } else {
          modifiedVariables.slice(0, 10).forEach(({ name, oldValue, newValue }) => {
            console.log(`      ~ --${name}`);
            console.log(`        Antes: ${oldValue}`);
            console.log(`        Ahora: ${newValue}`);
          });
          console.log(`      ... y ${modifiedVariables.length - 10} más`);
        }
      }
      
      if (removedVariables.length === 0 && addedVariables.length === 0 && modifiedVariables.length === 0) {
        console.log(`   ✓ Sin cambios (todas las variables se mantienen igual)`);
      }
    }
    
    console.log(`\n📝 Archivo guardado en: ${cssPath}`);
  } catch (error) {
    console.error('❌ Error al generar variables CSS:');
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if (error.stack) {
        console.error(`   ${error.stack}`);
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

// Ejecutar el script
main();

