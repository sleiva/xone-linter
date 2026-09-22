import type { XoneProjectModel, XoneColl } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

/**
 * Las colls que SÍ necesitan un progid propio, con el suyo. De la documentación, no deducida:
 * son los dos únicos casos que nombra, y viven normalmente en `mappings.xne`.
 */
const PROGID_DE_COLL_ESPECIAL: ReadonlyMap<string, string> = new Map([
  ['empresas', 'ASGestion.CASEmpresa'],
  ['usuarios', 'ASGestion.CASUser'],
]);

export class RequiredAttributesRule implements ValidationRule {
  readonly name = 'RequiredAttributes';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    for (const coll of project.colls) {
      this.validateColl(coll, result);
    }

    // app.xml debe tener al menos un entry-point o entry-point attribute
    const app = project.app;
    if (app.entryPoints.length === 0 && !app.attributes['entry-point']) {
      result.error('APP_NO_ENTRY', 'app.xml no define punto de entrada (entry-point)', app.location.file, app.location);
    }
  }

  private validateColl(coll: XoneColl, result: ValidationResult): void {
    /**
     * `progid` NO es obligatorio, y la regla que decía que sí estaba inventada.
     *
     * Decía «si tiene objname, progid es obligatorio» y con eso marcaba como ERROR 20 ficheros
     * de cuatro apps distintas que están en producción y arrancan — entre ellas MyAllXOne, que
     * se lanzó en el emulador y navegó. La documentación lo desmiente en TRES sitios
     * independientes, y su tabla de atributos tiene columna «Obligatorio» con un **No**:
     *
     *   «`progid` es **opcional**. Si se omite, la coll se comporta como un objeto de datos
     *    genérico (equivalente a `ASData.CASBasicDataObj`).»
     *
     * Y dice que el error de verdad es el CONTRARIO: olvidar el progid propio en las dos colls
     * ESPECIALES, que lo necesitan para activar su lógica de negocio. Eso es lo que se
     * comprueba ahora — por el nombre de la coll, que es lo que la documentación nombra.
     *
     * Importa más de lo que parece porque esta regla va a decidir si se ACEPTA una escritura:
     * un falso positivo aquí no es un aviso de más, es un fichero que no se puede guardar.
     */
    const progidEsperado = PROGID_DE_COLL_ESPECIAL.get(coll.name.toLowerCase());
    if (progidEsperado && coll.attributes.progid !== progidEsperado) {
      result.error(
        'COLL_MISSING_PROGID',
        `La colección especial "${coll.name}" necesita progid="${progidEsperado}" para activar su `
        + `lógica de negocio${coll.attributes.progid ? `, y tiene "${coll.attributes.progid}"` : ' y no lo lleva'}.`,
        coll.location.file,
        coll.location,
      );
    }

    // Grupos deben tener id
    for (const group of coll.groups) {
      if (!group.id) {
        result.error(
          'GROUP_MISSING_ID',
          `El grupo "${group.name ?? '(sin nombre)'}" de "${coll.name}" no tiene atributo id`,
          group.location.file,
          group.location,
        );
      }
    }

    // Props deben tener name y type
    for (const prop of coll.props) {
      if (!prop.name) {
        result.error('PROP_MISSING_NAME', `Prop en "${coll.name}" sin atributo name`, prop.location.file, prop.location);
      }
      /**
       * Sin `type` es un AVISO, no un error, y la diferencia se midió.
       *
       * La documentación lo marca como obligatorio, así que la comprobación se queda. Pero no
       * impide que la app funcione: 9 props de cuatro apps en producción no lo llevan, y el
       * caso es siempre el mismo —`<prop name="BTLINEA" class="btLineaContent" tmargin="50p"/>`,
       * una línea decorativa cuyo aspecto lo pone el CSS—, idéntico en dos apps distintas. El
       * motor le da un tipo por omisión y pinta.
       *
       * Un error aquí impediría guardar un fichero que arranca. La regla del harness es la que
       * ya usa el verificador del turno: lo que no rompe se CUENTA, no bloquea.
       */
      if (!prop.type) {
        result.warning('PROP_MISSING_TYPE', `Prop "${prop.name ?? '(sin nombre)'}" en "${coll.name}" sin atributo type`, prop.location.file, prop.location);
      }
    }
  }
}
