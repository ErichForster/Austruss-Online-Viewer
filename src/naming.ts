// Parses the Austruss model-file naming convention:
//   <JobNumber>-<ProductCode>-<Zone>-<DrawingNumber>[revision]<description>.ifc
// e.g. "25177-LGS-A2-410__A__BUILDING_A2_-_3D_Model_-_IFC.ifc"
//      "25177-LGS-A1-410 [B] BUILDING A1 - 3D Model - IFC.ifc"
//      "25177-LGS-ALL-410_ALL_BUILDING_-_IFC.ifc"
//
// Job number, product code, zone, and drawing number are load-bearing for
// sorting/grouping in the catalog. Everything after that prefix is treated
// as free-form description text and only used for display.

export interface ParsedModelName {
  jobNumber: string;
  productCode: string;
  zone: string;
  drawingNumber: string;
  revision: string | null;
  description: string;
  filename: string;
}

const PREFIX_PATTERN = /^(\d{3,6})-([A-Z]+)-([A-Z0-9]+)-(\d+)/;

export function parseModelFilename(filename: string): ParsedModelName | null {
  const base = filename.replace(/\.(ifc|frag)$/i, "");
  const match = base.match(PREFIX_PATTERN);
  if (!match) return null;

  const [, jobNumber, productCode, zone, drawingNumber] = match;
  let rest = base.slice(match[0].length);

  let revision: string | null = null;
  const bracketRev = rest.match(/\[([A-Za-z0-9]+)\]/);
  const underscoreRev = rest.match(/^_+([A-Za-z0-9])_+/);
  if (bracketRev) {
    revision = bracketRev[1];
    rest = rest.slice(0, bracketRev.index) + rest.slice(bracketRev.index! + bracketRev[0].length);
  } else if (underscoreRev) {
    revision = underscoreRev[1];
    rest = rest.slice(underscoreRev[0].length);
  }

  const description = rest
    .replace(/^[-_\s]+|[-_\s]+$/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { jobNumber, productCode, zone, drawingNumber, revision, description, filename };
}
