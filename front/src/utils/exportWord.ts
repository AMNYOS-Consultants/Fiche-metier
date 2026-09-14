import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type {
  Couple,
  CritereAcces,
  Detail,
  Metier,
  MetierCondition,
  MetierProche,
  MetierTransversale,
  ConnaissanceMetier,
  RomeReferentiel,
} from '@/types/api';
import { libelleFamille } from './format';
import logoAmnyos from '@/assets/logo-amnyos.png';
import logoOcapiat from '@/assets/logo-ocapiat.png';
import logoCgConseil from '@/assets/logo-cg-conseil.png';
import logoAmnyosBandeau from '@/assets/logo-amnyos-bandeau.png';

/**
 * Palette et échelle d'espacement recopiées de index.css (`--couleur-*`, `--rayon`) : le
 * .docx doit se lire comme une impression de la fiche, pas comme un document à part.
 * 1rem = 16px = 240 twips (unité native docx) : les paddings ci-dessous sont convertis
 * directement depuis leurs équivalents CSS.
 */
const TEXTE = '1C2330';
const TEXTE_DOUX = '5B6577';
const ACCENT = '2C5F8A';
const ACCENT_DOUX = 'EAF1F7';
const BORDURE = 'E2E5EA';

const REM = 240;

const ORDINAUX = ['Premier', 'Deuxième', 'Troisième', 'Quatrième', 'Cinquième', 'Sixième'];
function ordinal(n: number): string {
  return ORDINAUX[n - 1] ?? `${n}ᵉ`;
}

const BORDURE_LEGERE = { style: BorderStyle.SINGLE, size: 4, color: BORDURE };
const SANS_BORDURE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

const BORDURES_CARTE = {
  top: BORDURE_LEGERE,
  bottom: BORDURE_LEGERE,
  left: BORDURE_LEGERE,
  right: BORDURE_LEGERE,
};
const BORDURES_TABLEAU = {
  ...BORDURES_CARTE,
  insideHorizontal: BORDURE_LEGERE,
  insideVertical: SANS_BORDURE,
};
const SANS_BORDURES = {
  top: SANS_BORDURE,
  bottom: SANS_BORDURE,
  left: SANS_BORDURE,
  right: SANS_BORDURE,
  insideHorizontal: SANS_BORDURE,
  insideVertical: SANS_BORDURE,
};

/** Espace vide entre deux blocs — les cartes n'ont pas de `margin-bottom` docx natif. */
function espace(apres = REM): Paragraph {
  return new Paragraph({ text: '', spacing: { after: apres } });
}

function titre2(texte: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: texte, bold: true, size: 26, color: TEXTE })],
    spacing: { after: REM * 0.5 },
  });
}

/** Style `.acces__titre` : libellé discret souligné d'un filet, sans fond. */
function sousTitre(texte: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: texte, bold: true, size: 20, color: TEXTE_DOUX })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDURE, space: 4 } },
    spacing: { before: REM * 0.75, after: REM * 0.4 },
  });
}

/** Style `.transversales__titre` : bandeau plein accent-doux, comme un pill étiré. */
function bandeauDoux(texte: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: SANS_BORDURES,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: ACCENT_DOUX },
            margins: { top: 96, bottom: 96, left: 180, right: 180 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: texte, bold: true, size: 20, color: TEXTE_DOUX })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

/** Style `.couple__entete` : bandeau plein accent, texte blanc, titre à gauche / code à droite. */
function bandeauAccent(gauche: string, droite: string): Table {
  const cellule = (texte: string, alignement: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
    new TableCell({
      shading: { fill: ACCENT },
      margins: { top: 96, bottom: 96, left: 180, right: 180 },
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({
          alignment: alignement,
          children: [new TextRun({ text: texte, bold: true, size: 20, color: 'FFFFFF' })],
        }),
      ],
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: SANS_BORDURES,
    rows: [new TableRow({ children: [cellule(gauche, AlignmentType.LEFT), cellule(droite, AlignmentType.RIGHT)] })],
  });
}

/** Carte `.fiche__section` : fond blanc, filet gris, padding généreux. */
function carte(...enfants: Array<Paragraph | Table>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: BORDURES_CARTE,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            margins: { top: REM, bottom: REM, left: REM * 1.25, right: REM * 1.25 },
            children: enfants,
          }),
        ],
      }),
    ],
  });
}

function celluleTexte(
  texte: string,
  opts: { entete?: boolean; centre?: boolean; doux?: boolean } = {},
): TableCell {
  return new TableCell({
    shading: opts.entete ? { fill: ACCENT_DOUX } : undefined,
    margins: { top: 120, bottom: 120, left: 180, right: 180 },
    children: [
      new Paragraph({
        alignment: opts.centre ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [
          new TextRun({
            text: texte,
            bold: opts.entete,
            size: 20,
            color: opts.entete ? ACCENT : opts.doux ? TEXTE_DOUX : TEXTE,
          }),
        ],
      }),
    ],
  });
}

function celluleMultiligne(lignes: string[]): TableCell {
  return new TableCell({
    margins: { top: 120, bottom: 120, left: 180, right: 180 },
    children:
      lignes.length > 0
        ? lignes.map((l) => new Paragraph({ children: [new TextRun({ text: l, size: 20, color: TEXTE })] }))
        : [new Paragraph({ children: [new TextRun({ text: '—', size: 20, color: TEXTE_DOUX })] })],
  });
}

function ligneEntete(libelles: string[]): TableRow {
  return new TableRow({ children: libelles.map((l) => celluleTexte(l, { entete: true })) });
}

function tableau(rows: TableRow[]): Table {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: BORDURES_TABLEAU, rows });
}

/** Table des 15 conditions d'exercice — partagée par les deux modèles d'export. */
function tableauConditionsExercice(conditions: MetierCondition[]): Table {
  const triees = [...conditions].sort((a, b) => (a.critere?.ordre ?? 0) - (b.critere?.ordre ?? 0));
  return tableau([
    ligneEntete(['Condition', 'Non significatif', 'Significatif']),
    ...triees.map(
      (c) =>
        new TableRow({
          children: [
            celluleTexte(c.critere?.libelle ?? c.codeCondition),
            celluleTexte(c.valeur === 'non_significatif' ? 'X' : '', { centre: true }),
            celluleTexte(c.valeur === 'significatif' ? 'X' : '', { centre: true }),
          ],
        }),
    ),
  ]);
}

function listeDetails(details: Detail[] | undefined): string[] {
  return [...(details ?? [])].sort((a, b) => a.ordre - b.ordre).map((d) => `•  ${d.libelle}`);
}

function libellesDetails(details: Detail[] | undefined): string[] {
  return [...(details ?? [])].sort((a, b) => a.ordre - b.ordre).map((d) => d.libelle);
}

function phraseNiveau(basse: string | undefined, haute: string | undefined): string | null {
  if (!basse && !haute) return null;
  if (!basse || !haute || basse === haute) return `Un diplôme de ${basse ?? haute} est attendu.`;
  return `Un diplôme de ${basse} à un ${haute} est attendu.`;
}

const SANS_GROUPE_ACCES = 'Autres conditions';
const BORNE_BASSE = 'ACCES_3';
const BORNE_HAUTE = 'ACCES_4';

/**
 * Commun aux deux exports : en-tête de page (logo), styles par défaut, et le
 * téléchargement lui-même. Le contenu passé ici est déjà entièrement construit — aucun
 * contrôle de filtre ne transite jamais par ce chemin, seules des données le peuvent.
 */
/** Image PNG → Buffer, pour `ImageRun`. */
async function chargerImage(source: string): Promise<ArrayBuffer> {
  return fetch(source).then((r) => r.arrayBuffer());
}

async function enteteAmnyos(): Promise<Header> {
  const logoBuffer = await chargerImage(logoAmnyos);
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new ImageRun({ type: 'png', data: logoBuffer, transformation: { width: 108, height: 45 } }),
        ],
      }),
    ],
  });
}

async function construireEtTelecharger(
  contenu: Array<Paragraph | Table>,
  nomFichier: string,
  options?: { entete?: Header; piedDePage?: Footer },
): Promise<void> {
  const entete = options?.entete ?? (await enteteAmnyos());

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Segoe UI', size: 20, color: TEXTE },
          paragraph: { spacing: { line: 300 } },
        },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1300, bottom: 1000, left: 1000, right: 1000 } } },
        headers: { default: entete },
        footers: options?.piedDePage ? { default: options.piedDePage } : undefined,
        children: contenu,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}

interface ExportParams {
  metier: Metier;
  couples: Couple[];
  connaissances: ConnaissanceMetier[];
  proches: MetierProche[];
  criteresAcces: CritereAcces[];
}

export async function exporterFicheMetierWord(params: ExportParams): Promise<void> {
  const { metier: m, couples, connaissances, proches, criteresAcces } = params;
  const contenu: Array<Paragraph | Table> = [];

  // ---------- En-tête de fiche (équivalent .fiche__entete) ----------
  contenu.push(
    new Paragraph({
      children: [
        new TextRun({
          text: ` ${m.codeMetier} `,
          size: 18,
          color: TEXTE_DOUX,
          shading: { fill: ACCENT_DOUX },
        }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: m.intitule, bold: true, size: 32, color: TEXTE })],
      spacing: { after: m.famille ? 40 : REM },
    }),
  );
  if (m.famille) {
    contenu.push(
      new Paragraph({
        children: [new TextRun({ text: libelleFamille(m.famille), italics: true, size: 20, color: TEXTE_DOUX })],
        spacing: { after: REM },
      }),
    );
  }

  // ---------- Définition ----------
  if (m.definition) {
    contenu.push(
      carte(titre2('Définition'), new Paragraph({ children: [new TextRun({ text: m.definition, size: 20, color: TEXTE })] })),
      espace(),
    );
  }

  // ---------- Autres appellations ----------
  if ((m.appellations ?? []).length > 0) {
    contenu.push(
      carte(
        titre2('Autres appellations'),
        new Paragraph({
          children: [
            new TextRun({ text: m.appellations!.map((a) => a.appellation).join('   •   '), size: 20, color: ACCENT }),
          ],
        }),
      ),
      espace(),
    );
  }

  // ---------- Codes ROME ----------
  if ((m.codesRome ?? []).length > 0) {
    contenu.push(
      carte(
        titre2('Codes ROME'),
        new Paragraph({
          children: [new TextRun({ text: m.codesRome!.map((r) => r.codeRome).join('   •   '), size: 20, color: ACCENT })],
        }),
      ),
      espace(),
    );
  }

  // ---------- Conditions d'exercice + accès ----------
  const conditions = m.conditions ?? [];
  const acces = m.acces ?? [];
  if (conditions.length > 0 || acces.length > 0) {
    const blocs: Array<Paragraph | Table> = [titre2('Conditions d’exercice du métier')];

    if (conditions.length > 0) {
      blocs.push(tableauConditionsExercice(conditions));
    }

    if (acces.length > 0) {
      blocs.push(espace(REM * 0.75), sousTitre('Conditions d’accès au métier'));

      const reference =
        criteresAcces.length > 0 ? criteresAcces : acces.flatMap((a) => (a.critere ? [a.critere] : []));
      const parCode = new Map(acces.map((a) => [a.codeAcces, a] as const));
      const groupes = new Map<string, Array<{ question: string; reponse: string | null }>>();

      for (const critere of [...reference].sort((a, b) => a.ordre - b.ordre)) {
        if (critere.codeAcces === BORNE_HAUTE) continue;
        const reponse =
          critere.codeAcces === BORNE_BASSE
            ? phraseNiveau(parCode.get(BORNE_BASSE)?.valeur, parCode.get(BORNE_HAUTE)?.valeur)
            : (parCode.get(critere.codeAcces)?.valeur ?? null);
        const cle = critere.groupe ?? SANS_GROUPE_ACCES;
        if (!groupes.has(cle)) groupes.set(cle, []);
        groupes.get(cle)!.push({ question: critere.libelle, reponse: reponse || null });
      }

      let premier = true;
      for (const [groupe, entrees] of groupes) {
        blocs.push(
          new Paragraph({
            children: [new TextRun({ text: groupe, bold: true, size: 20, color: TEXTE })],
            spacing: { before: premier ? 0 : REM * 0.6, after: REM * 0.3 },
          }),
        );
        premier = false;
        for (const e of entrees) {
          blocs.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${e.question} `, size: 20, color: TEXTE }),
                new TextRun({
                  text: e.reponse ?? 'Non renseigné',
                  bold: true,
                  size: 20,
                  color: e.reponse ? ACCENT : TEXTE_DOUX,
                }),
              ],
              spacing: { after: REM * 0.3 },
            }),
          );
        }
      }
    }

    contenu.push(carte(...blocs), espace());
  }

  // ---------- Activités et compétences (couples) ----------
  if (couples.length > 0) {
    const blocs: Array<Paragraph | Table> = [titre2('Activités et compétences du métier')];
    const triees = [...couples].sort((a, b) => a.ordre - b.ordre);
    triees.forEach((c, i) => {
      blocs.push(
        bandeauAccent(`${ordinal(c.ordre)} couple activité-compétence professionnelles`, c.codeActivite),
        tableau([
          ligneEntete([c.intituleActivite ?? 'Activité', c.intituleCompetence ?? 'Compétence']),
          new TableRow({
            children: [
              celluleMultiligne(listeDetails(c.detailsActivite)),
              celluleMultiligne(listeDetails(c.detailsCompetence)),
            ],
          }),
        ]),
      );
      if ((c.motsCles ?? []).length > 0) {
        blocs.push(
          new Paragraph({
            spacing: { before: REM * 0.3, after: 0 },
            children: [
              new TextRun({ text: 'Mots clés  ', bold: true, size: 18, color: TEXTE_DOUX }),
              new TextRun({ text: c.motsCles!.map((mc) => mc.libelle).join('   •   '), size: 18, color: ACCENT }),
            ],
          }),
        );
      }
      if (i < triees.length - 1) blocs.push(espace(REM * 0.9));
    });
    contenu.push(carte(...blocs), espace());
  }

  // ---------- Ressources transverses ----------
  const transversales = m.transversales ?? [];
  if (transversales.length > 0) {
    const blocs: Array<Paragraph | Table> = [titre2('Ressources transverses mobilisées dans le travail')];
    const tries = [...transversales].sort((a, b) => (a.competence?.ordre ?? 0) - (b.competence?.ordre ?? 0));
    const groupes = new Map<string, typeof tries>();
    for (const t of tries) {
      const cle = t.competence?.groupe ?? 'Autres ressources';
      if (!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle)!.push(t);
    }
    let premier = true;
    for (const [groupe, items] of groupes) {
      if (!premier) blocs.push(espace(REM * 0.75));
      premier = false;
      blocs.push(
        bandeauDoux(groupe),
        espace(REM * 0.3),
        tableau([
          ligneEntete(['Ressource', 'Niveau d’approfondissement retenu']),
          ...items.map((t) => {
            const palier =
              t.competence && t.niveau !== null
                ? [t.competence.palier1, t.competence.palier2, t.competence.palier3, t.competence.palier4][
                    t.niveau - 1
                  ]
                : null;
            const texte =
              t.nonConcerne || t.niveau === null
                ? 'Non concerné'
                : `Niveau ${t.niveau}/4 — ${palier ?? 'palier non renseigné'}`;
            return new TableRow({
              children: [celluleTexte(t.competence?.libelle ?? t.codeTransversale), celluleTexte(texte)],
            });
          }),
        ]),
      );
    }
    contenu.push(carte(...blocs), espace());
  }

  // ---------- Domaines de connaissances ----------
  {
    const blocs: Array<Paragraph | Table> = [
      titre2('Domaines de connaissances structurant pour l’exercice du métier'),
    ];
    if (connaissances.length === 0) {
      blocs.push(new Paragraph({ children: [new TextRun({ text: 'Aucun domaine de connaissance renseigné.', size: 20, color: TEXTE_DOUX })] }));
    } else {
      blocs.push(
        tableau([
          ligneEntete(['Domaine de connaissances', 'Niveau', 'Formacode', 'NSF']),
          ...connaissances.map(
            (d) =>
              new TableRow({
                children: [
                  celluleTexte(d.intitule),
                  celluleTexte(d.niveau !== null ? String(d.niveau) : '—', { centre: true }),
                  celluleTexte(d.codeFormacode, { centre: true }),
                  celluleTexte(d.codeNsf ?? '—', { centre: true }),
                ],
              }),
          ),
        ]),
      );
    }
    contenu.push(carte(...blocs), espace());
  }

  // ---------- Métiers proches ----------
  {
    const blocs: Array<Paragraph | Table> = [titre2('Métiers proches')];
    if (proches.length === 0) {
      blocs.push(
        new Paragraph({ children: [new TextRun({ text: 'Aucune passerelle calculée.', size: 20, color: TEXTE_DOUX })] }),
      );
    } else {
      for (const p of proches) {
        const detail = p.dureeAcquisitionHeures !== null ? ` — ${p.dureeAcquisitionHeures} h d’acquisition` : '';
        blocs.push(
          new Paragraph({
            spacing: { after: REM * 0.3 },
            children: [
              new TextRun({ text: '•  ', size: 20, color: ACCENT }),
              new TextRun({ text: p.intitule, size: 20, color: TEXTE }),
              new TextRun({ text: detail, size: 18, color: TEXTE_DOUX }),
            ],
          }),
        );
      }
    }
    contenu.push(carte(...blocs));
  }

  await construireEtTelecharger(contenu, `fiche-metier-${m.codeMetier}.docx`);
}

interface ExportPasserellesParams {
  metierSource: { codeMetier: string; intitule: string };
  parametres: { dcMin: number; heuresMax: number; degreMin: number; memeFamille: boolean };
  resultats: MetierProche[];
}

/**
 * Export de l'écran Passerelles. `resultats` est déjà filtré (dont, le cas échéant, le
 * filtre « même famille » qui n'existe que côté front) : comme pour la fiche métier, seule
 * la donnée traverse cette fonction, jamais les contrôles de filtre eux-mêmes.
 */
export async function exporterPasserellesWord(params: ExportPasserellesParams): Promise<void> {
  const { metierSource, parametres, resultats } = params;
  const contenu: Array<Paragraph | Table> = [];

  contenu.push(
    new Paragraph({
      children: [new TextRun({ text: 'Métiers passerelles', bold: true, size: 32, color: TEXTE })],
      spacing: { after: REM * 0.3 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Métier de départ : ${metierSource.intitule} (${metierSource.codeMetier})`,
          size: 20,
          color: TEXTE_DOUX,
        }),
      ],
      spacing: { after: REM * 0.4 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: [
            `Minimum DC communs : ${parametres.dcMin}`,
            `Max heures formation : ${parametres.heuresMax}`,
            `Minimum degré d’élargissement : ${parametres.degreMin}`,
            parametres.memeFamille ? 'Même famille uniquement' : null,
          ]
            .filter(Boolean)
            .join('   ·   '),
          italics: true,
          size: 18,
          color: TEXTE_DOUX,
        }),
      ],
      spacing: { after: REM },
    }),
  );

  const blocs: Array<Paragraph | Table> = [titre2(`${resultats.length} métier(s) passerelle(s)`)];
  if (resultats.length === 0) {
    blocs.push(
      new Paragraph({
        children: [new TextRun({ text: 'Aucun métier ne correspond à ces paramètres.', size: 20, color: TEXTE_DOUX })],
      }),
    );
  } else {
    blocs.push(
      tableau([
        ligneEntete(['Intitulé métier', 'Nb de DC communs', 'Différence heures formation', 'Degré d’élargissement']),
        ...resultats.map(
          (r) =>
            new TableRow({
              children: [
                celluleTexte(r.intitule),
                celluleTexte(r.nbDcCommuns !== null ? String(r.nbDcCommuns) : '—', { centre: true }),
                celluleTexte(
                  r.dureeAcquisitionHeures !== null ? String(Math.round(Number(r.dureeAcquisitionHeures))) : '—',
                  { centre: true },
                ),
                celluleTexte(r.degreElargissement !== null ? Number(r.degreElargissement).toFixed(2) : '—', {
                  centre: true,
                }),
              ],
            }),
        ),
      ]),
    );
  }
  contenu.push(carte(...blocs));

  await construireEtTelecharger(contenu, `passerelles-${metierSource.codeMetier}.docx`);
}

// ---------- Export au modèle OCAPIAT ----------
//
// Contenu ET mise en page reconstitués depuis docs/EXEMPLE FICHE METIER.docx (classeur fourni
// hors dépôt) — styles.xml et le corps du document, pas seulement le texte brut :
//   - bannières pleine largeur navy (Titre1, fill 002060) pour les sections majeures
//     (Présentation du métier, Activités et compétences, Ressources transverses, Domaines
//     de connaissances, Passerelles) et rouge (Titre4, fill EE0000) pour ANNEXES ;
//   - sous-titres orange (style « Question », FF6600, Segoe UI gras) pour chaque champ ;
//   - tableaux à bordures gris clair (BFBFBF, style « Grille de tableau claire ») SANS
//     en-tête colorée — contrairement à l'export standard, aucune cellule n'est teintée ;
//   - Segoe UI 10pt (sz 20) dans les tableaux, comme le style « corpsdetexte » du modèle.
// Cette palette (OCA_*) n'a aucun rapport avec celle de l'export standard plus haut dans ce
// fichier : les deux exports ne doivent jamais se mélanger.

const OCA_NAVY = '002060';
const OCA_ROUGE = 'EE0000';
const OCA_ROUGE_VIF = 'FF0000';
const OCA_ROUGE_FONCE = 'C00000';
const OCA_ORANGE = 'FF6600';
const OCA_BORDURE = 'BFBFBF';
const OCA_TEXTE = '000000';
const OCA_POLICE = 'Segoe UI';
/** Puce « flèche » du modèle (police Symbol, position F03E). */
const OCA_PUCE = '';
const OCA_POLICE_PUCE = 'Symbol';

const OCA_BORDURE_LEGERE = { style: BorderStyle.SINGLE, size: 4, color: OCA_BORDURE };
const OCA_BORDURES = {
  top: OCA_BORDURE_LEGERE,
  bottom: OCA_BORDURE_LEGERE,
  left: OCA_BORDURE_LEGERE,
  right: OCA_BORDURE_LEGERE,
  insideHorizontal: OCA_BORDURE_LEGERE,
  insideVertical: OCA_BORDURE_LEGERE,
};

/** Bannière pleine largeur — Titre1 (navy, sections majeures) / Titre4 (rouge, ANNEXES). */
function ocaBanniere(texte: string, couleur: string = OCA_NAVY): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: OCA_BORDURES,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: couleur },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: texte, bold: true, size: 36, color: 'FFFFFF', font: OCA_POLICE })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

/** Sous-titre orange (style « Question ») — texte seul, sans fond ni soulignement. */
function ocaSousTitre(texte: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: texte, bold: true, size: 24, color: OCA_ORANGE, font: OCA_POLICE })],
    spacing: { before: REM * 0.6, after: REM * 0.2 },
  });
}

/** Sous-titre « Question » en rouge foncé — questions internes (codes, annexes). */
function ocaSousTitreRouge(texte: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: texte, bold: true, size: 24, color: OCA_ROUGE_FONCE, font: OCA_POLICE })],
    spacing: { before: REM * 0.6, after: REM * 0.2 },
  });
}

function ocaTexte(texte: string, opts: { gras?: boolean; couleur?: string } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: texte, bold: opts.gras, size: 20, color: opts.couleur ?? OCA_TEXTE, font: OCA_POLICE })],
  });
}

/** Encadré gris clair sous un sous-titre — une par champ, comme les cases à remplir du modèle. */
function ocaBoite(...enfants: Paragraph[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: OCA_BORDURES,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: enfants,
          }),
        ],
      }),
    ],
  });
}

function ocaCellule(
  texte: string,
  opts: {
    gras?: boolean;
    centre?: boolean;
    colSpan?: number;
    rowSpan?: number;
    couleur?: string;
    /** Largeur en % de la table — sans ça Word répartit les colonnes à parts égales, ce qui
     * écrase les cellules de contenu quand une colonne voisine ne porte qu'un code court
     * (MOT_CLE_ACT_n, formacode, niveau…). */
    largeur?: number;
  } = {},
): TableCell {
  return new TableCell({
    columnSpan: opts.colSpan,
    rowSpan: opts.rowSpan,
    width: opts.largeur !== undefined ? { size: opts.largeur, type: WidthType.PERCENTAGE } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: [
      new Paragraph({
        alignment: opts.centre ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [new TextRun({ text: texte, bold: opts.gras, size: 20, color: opts.couleur ?? OCA_TEXTE, font: OCA_POLICE })],
      }),
    ],
  });
}

/** Cellule à puces « flèche » — même glyphe (police Symbol, F03E) que les listes du modèle. */
function ocaCelluleMultiligne(lignes: string[], couleur: string = OCA_TEXTE): TableCell {
  return new TableCell({
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children:
      lignes.length > 0
        ? lignes.map(
            (l) =>
              new Paragraph({
                indent: { left: 200, hanging: 200 },
                children: [
                  new TextRun({ text: OCA_PUCE, bold: true, size: 20, color: couleur, font: OCA_POLICE_PUCE }),
                  new TextRun({ text: `  ${l}`, size: 20, color: couleur, font: OCA_POLICE }),
                ],
              }),
          )
        : [new Paragraph({ children: [new TextRun({ text: '—', size: 20, color: couleur, font: OCA_POLICE })] })],
  });
}

function ocaTableau(rows: TableRow[]): Table {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: OCA_BORDURES, rows });
}

/** Table des 15 conditions — même en-tête que le modèle : gras, sans fond coloré. */
function ocaTableauConditions(conditions: MetierCondition[]): Table {
  const triees = [...conditions].sort((a, b) => (a.critere?.ordre ?? 0) - (b.critere?.ordre ?? 0));
  return ocaTableau([
    new TableRow({
      children: [ocaCellule(''), ocaCellule('Non significatif', { gras: true, centre: true }), ocaCellule('Significatif', { gras: true, centre: true })],
    }),
    ...triees.map(
      (c) =>
        new TableRow({
          children: [
            ocaCellule(c.critere?.libelle ?? c.codeCondition),
            ocaCellule(c.valeur === 'non_significatif' ? 'X' : '', { centre: true }),
            ocaCellule(c.valeur === 'significatif' ? 'X' : '', { centre: true }),
          ],
        }),
    ),
  ]);
}

const NIVEAUX_CNCP = [3, 4, 5, 6, 7, 8] as const;
const DIPLOME_PAR_NIVEAU_CNCP: Record<(typeof NIVEAUX_CNCP)[number], string> = {
  3: 'CAP, BEP',
  4: 'BAC, BP',
  5: 'BTS, DUT',
  6: 'LP',
  7: 'Master',
  8: 'Doctorat',
};

function libelleInterfaceOcapiat(valeur: string | null): string {
  switch (valeur) {
    case 'Oui, en amont OU aval':
      return 'Amont ou aval';
    case 'Oui, en amont ET aval':
      return 'Amont et aval';
    case 'Non':
      return 'Non';
    default:
      return 'Non renseigné';
  }
}

/** « Domaine des achats… » → « dans le domaine des achats… » ; sinon repli générique. */
function clauseDomaine(domaine: string | null | undefined): string {
  const texte = domaine?.trim();
  if (!texte) return '';
  if (/^domaine/i.test(texte)) return ` dans le ${texte.charAt(0).toLowerCase()}${texte.slice(1)}`;
  return ` dans le domaine ${texte}`;
}

/**
 * Synthétise ACCES_1/2/3/4 en phrase, sur le modèle du classeur (« Une certification de
 * niveau X (diplôme) … est exigée/souhaitée. »). Best effort : une saisie libre trop
 * inhabituelle en ACCES_2 peut donner une tournure un peu bancale — à relire avant diffusion.
 */
function phraseCertification(
  acces1: string | null,
  acces2: string | null,
  acces3: string | null,
  acces4: string | null,
): string | null {
  if (!acces1) return null;
  if (/^Oui/i.test(acces1)) {
    return 'Ce métier est accessible pour des personnes sans qualification ou certification professionnelle particulière.';
  }
  const modalite = /exig/i.test(acces1) ? 'exigée' : 'souhaitée';
  const niveaux: string[] = [];
  for (const n of [acces3, acces4]) {
    if (!n || niveaux.some((p) => p.includes(n))) continue;
    const num = n.replace(/^Niv\./, '');
    const diplome = DIPLOME_PAR_NIVEAU_CNCP[Number(num) as (typeof NIVEAUX_CNCP)[number]];
    niveaux.push(diplome ? `de niveau ${num} (${diplome})` : `de niveau ${num}`);
  }
  const phraseNiveau = niveaux.length > 0 ? `Une certification ${niveaux.join(' ou ')}` : 'Une certification';
  return `${phraseNiveau}${clauseDomaine(acces2)} est ${modalite}.`;
}

function phraseExperience(acces5: string | null, acces6: string | null): string | null {
  if (!acces5 || /^NSP/i.test(acces5)) return null;
  if (/^Oui/i.test(acces5)) {
    return 'Ce métier est généralement accessible sans expérience professionnelle.';
  }
  const modalite = /indispensable/i.test(acces5) ? 'est indispensable' : 'est souhaitée';
  const domaine = clauseDomaine(acces6);
  return `Une première expérience professionnelle${domaine || ' en lien avec le métier'} ${modalite}.`;
}

/** Grille CNCP 3-8 / Diplôme, avec un X sous le niveau inférieur et un sous le supérieur. */
function ocaTableauNiveauQualification(basse: string | null, haute: string | null): Table {
  const basseNum = basse ? Number(basse.replace(/^Niv\./, '')) : null;
  const hauteNum = haute ? Number(haute.replace(/^Niv\./, '')) : null;
  return ocaTableau([
    new TableRow({
      children: [ocaCellule('CNCP', { gras: true }), ...NIVEAUX_CNCP.map((n) => ocaCellule(String(n), { centre: true }))],
    }),
    new TableRow({
      children: [
        ocaCellule('Diplôme', { gras: true }),
        ...NIVEAUX_CNCP.map((n) => ocaCellule(DIPLOME_PAR_NIVEAU_CNCP[n], { centre: true })),
      ],
    }),
    new TableRow({
      children: [
        ocaCellule('Niveau inférieur inclus'),
        ...NIVEAUX_CNCP.map((n) => ocaCellule(n === basseNum ? 'X' : '', { centre: true })),
      ],
    }),
    new TableRow({
      children: [
        ocaCellule('Niveau supérieur inclus'),
        ...NIVEAUX_CNCP.map((n) => ocaCellule(n === hauteNum ? 'X' : '', { centre: true })),
      ],
    }),
  ]);
}

/** NSF / Forma-code / Domaine sur deux lignes de fusion verticale, « Niveau d'approfondissement » fusionné sur 4 colonnes. */
function ocaTableauDomaines(domaines: ConnaissanceMetier[]): Table {
  return ocaTableau([
    new TableRow({
      children: [
        ocaCellule('NSF', { gras: true, centre: true, rowSpan: 2, largeur: 8 }),
        ocaCellule('Forma-code', { gras: true, centre: true, rowSpan: 2, largeur: 10 }),
        ocaCellule('Domaine de connaissances mobilisé', { gras: true, rowSpan: 2, largeur: 42 }),
        ocaCellule('Niveau d’approfondissement', { gras: true, centre: true, colSpan: 4, largeur: 40 }),
      ],
    }),
    new TableRow({
      children: [1, 2, 3, 4].map((n) => ocaCellule(String(n), { gras: true, centre: true, largeur: 10 })),
    }),
    ...domaines.map(
      (d) =>
        new TableRow({
          children: [
            ocaCellule(d.codeNsf ?? '—', { centre: true, largeur: 8 }),
            ocaCellule(d.codeFormacode, { centre: true, largeur: 10 }),
            ocaCellule(d.intitule, { largeur: 42 }),
            ...[1, 2, 3, 4].map((n) => ocaCellule(d.niveau === n ? 'X' : '', { centre: true, largeur: 10 })),
          ],
        }),
    ),
  ]);
}

function ocaTableauRessourcesTransverses(transversales: MetierTransversale[]): Table {
  const triees = [...transversales].sort((a, b) => (a.competence?.ordre ?? 0) - (b.competence?.ordre ?? 0));
  return ocaTableau([
    new TableRow({
      children: [
        ocaCellule('Ressources transverses', { gras: true }),
        ocaCellule('Niveau d’approfondissement', { gras: true }),
        ocaCellule('Niveau', { gras: true, centre: true }),
      ],
    }),
    ...triees.map((t) => {
      const palier =
        t.competence && t.niveau !== null
          ? [t.competence.palier1, t.competence.palier2, t.competence.palier3, t.competence.palier4][t.niveau - 1]
          : null;
      const texte = t.nonConcerne || t.niveau === null ? '/' : (palier ?? `Niveau ${t.niveau}`);
      return new TableRow({
        children: [
          ocaCellule(t.competence?.libelle ?? t.codeTransversale),
          ocaCellule(texte),
          ocaCellule(t.nonConcerne || t.niveau === null ? '/' : String(t.niveau), { centre: true }),
        ],
      });
    }),
  ]);
}

/**
 * Une ligne par (couple, domaine de connaissance) — pas dédoublonné, contrairement au tableau
 * ci-dessus. `ac.intitule` est souvent NULL au niveau du couple (saisie incomplète) : on
 * retombe sur l'intitulé déjà résolu de la liste dédoublonnée (elle-même adossée au
 * référentiel `formacode`, voir metier.controller.ts `obtenirConnaissancesMetier`).
 */
function ocaTableauChainage(couples: Couple[], connaissances: ConnaissanceMetier[]): Table {
  const intituleParFormacode = new Map(connaissances.map((d) => [d.codeFormacode, d.intitule] as const));
  const lignes = couples.flatMap((c) =>
    (c.connaissances ?? []).map((k) => ({
      code: c.codeActivite,
      formacode: k.codeFormacode,
      intitule: k.intitule || intituleParFormacode.get(k.codeFormacode) || k.codeFormacode,
      niveau: k.niveau,
    })),
  );
  return ocaTableau([
    new TableRow({
      children: [
        ocaCellule('Code couple activité-compétence', {
          gras: true,
          centre: true,
          couleur: OCA_ROUGE_FONCE,
          largeur: 20,
        }),
        ocaCellule('Formacode', { gras: true, centre: true, couleur: OCA_ROUGE_FONCE, largeur: 12 }),
        ocaCellule('Intitulé du Formacode', { gras: true, couleur: OCA_ROUGE_FONCE, largeur: 53 }),
        ocaCellule('Niveau approfondissement', { gras: true, centre: true, couleur: OCA_ROUGE_FONCE, largeur: 15 }),
      ],
    }),
    ...lignes.map(
      (l) =>
        new TableRow({
          children: [
            ocaCellule(l.code, { centre: true, couleur: OCA_ROUGE_FONCE, largeur: 20 }),
            ocaCellule(l.formacode, { centre: true, couleur: OCA_ROUGE_FONCE, largeur: 12 }),
            ocaCellule(l.intitule, { couleur: OCA_ROUGE_FONCE, largeur: 53 }),
            ocaCellule(l.niveau !== null ? String(l.niveau) : '—', {
              centre: true,
              couleur: OCA_ROUGE_FONCE,
              largeur: 15,
            }),
          ],
        }),
    ),
  ]);
}

async function enteteOcapiat(): Promise<Header> {
  const logoBuffer = await chargerImage(logoOcapiat);
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new ImageRun({ type: 'png', data: logoBuffer, transformation: { width: 60, height: 60 } })],
      }),
    ],
  });
}

async function piedDePageOcapiat(): Promise<Footer> {
  const [bandeauBuffer, cgBuffer] = await Promise.all([
    chargerImage(logoAmnyosBandeau),
    chargerImage(logoCgConseil),
  ]);
  return new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: 'right', position: 9020 }],
        children: [
          new ImageRun({ type: 'png', data: cgBuffer, transformation: { width: 62, height: 30 } }),
          new TextRun({ text: '\t' }),
          new ImageRun({ type: 'png', data: bandeauBuffer, transformation: { width: 62, height: 18 } }),
        ],
      }),
    ],
  });
}

interface ExportOcapiatParams {
  metier: Metier;
  couples: Couple[];
  connaissances: ConnaissanceMetier[];
  proches: MetierProche[];
  referentielRome: RomeReferentiel[];
}

/**
 * `inclureInterne=false` reproduit ce que docs/EXEMPLE FICHE METIER CLIENT.docx montre :
 * dans ce fichier, tout ce qui est à la fois surligné jaune, barré ET en rouge est le
 * contenu marqué pour suppression avant envoi au client (convention Word classique de
 * relecture). Ce marquage tombe très exactement sur nos trois couleurs OCA_ROUGE* : la
 * ligne Rédacteur, les encadrés Code famille/Code couple, et toute la bannière ANNEXES.
 * Les retirer entièrement (pas juste les recolorer) donne le contenu client.
 */
async function construireContenuOcapiat(
  params: ExportOcapiatParams,
  options: { inclureInterne: boolean },
): Promise<Array<Paragraph | Table>> {
  const { metier: m, couples, connaissances, proches, referentielRome } = params;
  const { inclureInterne } = options;
  const contenu: Array<Paragraph | Table> = [];

  const valeurAcces = new Map((m.acces ?? []).map((a) => [a.codeAcces, a.valeur] as const));
  const acces3 = valeurAcces.get('ACCES_3') ?? null;
  const acces4 = valeurAcces.get('ACCES_4') ?? null;

  // ---------- Titre (style « Titre2 » du modèle : orange, 26pt, centré) ----------
  contenu.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: m.intitule, bold: true, size: 52, color: OCA_ORANGE, font: OCA_POLICE })],
      spacing: { after: REM * 0.15 },
    }),
  );
  if (inclureInterne) {
    contenu.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Rédacteur : ${m.redacteur ?? 'XX'}`, bold: true, size: 22, color: OCA_ROUGE_VIF, font: OCA_POLICE }),
        ],
        spacing: { after: REM * 0.6 },
      }),
    );
  } else {
    contenu.push(new Paragraph({ spacing: { after: REM * 0.3 } }));
  }

  // ---------- Présentation du métier (bannière navy) ----------
  contenu.push(ocaBanniere('Présentation du métier'), espace(REM * 0.4));

  contenu.push(ocaSousTitre('Définition du métier'));
  contenu.push(ocaBoite(ocaTexte(m.definition ?? 'XX')));

  if ((m.appellations ?? []).length > 0) {
    contenu.push(ocaSousTitre('Exemples d’appellations du métier'));
    contenu.push(ocaBoite(...m.appellations!.map((a) => ocaTexte(a.appellation))));
  }

  if ((m.codesRome ?? []).length > 0) {
    const romeParCode = new Map(referentielRome.map((r) => [r.codeRome, r.libelle] as const));
    const texteRome = m
      .codesRome!.map((r) => {
        const libelle = romeParCode.get(r.codeRome);
        return libelle ? `${r.codeRome} - ${libelle}` : r.codeRome;
      })
      .join(' ; ');
    contenu.push(ocaSousTitre('Fiche(s) ROME de référence'));
    contenu.push(ocaBoite(ocaTexte(texteRome)));
  }

  if ((m.conditions ?? []).length > 0) {
    contenu.push(ocaSousTitre('Conditions d’exercice du métier'));
    contenu.push(ocaTableauConditions(m.conditions!));
  }

  contenu.push(ocaSousTitre('Niveau de qualification associé'));
  contenu.push(ocaTableauNiveauQualification(acces3, acces4));

  if (m.famille && inclureInterne) {
    contenu.push(ocaSousTitreRouge('Code famille de métiers'));
    contenu.push(ocaBoite(ocaTexte(libelleFamille(m.famille), { couleur: OCA_ROUGE_FONCE })));
  }

  {
    const phrases = [
      phraseCertification(valeurAcces.get('ACCES_1') ?? null, valeurAcces.get('ACCES_2') ?? null, acces3, acces4),
      phraseExperience(valeurAcces.get('ACCES_5') ?? null, valeurAcces.get('ACCES_6') ?? null),
      valeurAcces.get('ACCES_7')?.trim() || null,
    ].filter((p): p is string => Boolean(p));

    contenu.push(ocaSousTitre('Conditions d’accès au métier'));
    contenu.push(ocaBoite(...(phrases.length > 0 ? phrases.map((p) => ocaTexte(p)) : [ocaTexte('Non renseignées.')])));
  }

  contenu.push(espace(REM));

  // ---------- Activités et compétences du métier (bannière navy) ----------
  if (couples.length > 0) {
    contenu.push(ocaBanniere('Activités et compétences du métier'), espace(REM * 0.4));
    const triees = [...couples].sort((a, b) => a.ordre - b.ordre);
    triees.forEach((c, i) => {
      contenu.push(ocaSousTitre(`${ordinal(c.ordre)} couple « activité-compétence » professionnelles`));
      contenu.push(
        ocaTableau([
          new TableRow({
            children: [
              ocaCellule(c.intituleActivite ?? 'XX', { gras: true }),
              ocaCellule(c.intituleCompetence ?? 'XX', { gras: true }),
            ],
          }),
          new TableRow({
            children: [
              ocaCelluleMultiligne(libellesDetails(c.detailsActivite)),
              ocaCelluleMultiligne(libellesDetails(c.detailsCompetence)),
            ],
          }),
        ]),
      );

      if ((c.motsCles ?? []).length > 0) {
        contenu.push(espace(REM * 0.3), ocaSousTitre('Mots clés du couple activité-compétence'));
        contenu.push(
          ocaTableau(
            c.motsCles!.map(
              (mc, j) =>
                new TableRow({
                  children: [
                    ocaCellule(`MOT_CLE_ACT_${j + 1}`, { gras: true, largeur: 20 }),
                    ocaCellule(mc.libelle, { largeur: 80 }),
                  ],
                }),
            ),
          ),
        );
      }

      if (inclureInterne) {
        contenu.push(espace(REM * 0.3), ocaSousTitreRouge('Code couple activité-compétence'));
        contenu.push(ocaBoite(ocaTexte(c.codeActivite)));
      }
      if (i < triees.length - 1) contenu.push(espace(REM * 0.7));
    });
    contenu.push(espace(REM));
  }

  // ---------- Ressources transverses mobilisées (bannière navy) ----------
  if ((m.transversales ?? []).length > 0) {
    contenu.push(ocaBanniere('Ressources transverses mobilisées'), espace(REM * 0.4));
    contenu.push(ocaTableauRessourcesTransverses(m.transversales!), espace(REM));
  }

  // ---------- Domaines de connaissances (bannière navy) ----------
  contenu.push(ocaBanniere('Domaines de connaissances'), espace(REM * 0.4));
  contenu.push(
    connaissances.length === 0 ? ocaTexte('Aucun domaine de connaissance renseigné.') : ocaTableauDomaines(connaissances),
  );
  contenu.push(espace(REM));

  // ---------- Passerelles métiers (bannière navy) ----------
  contenu.push(ocaBanniere('Passerelles métiers'), espace(REM * 0.4));
  contenu.push(
    ocaBoite(
      ...(proches.length === 0
        ? [ocaTexte('Aucune passerelle calculée pour l’instant.')]
        : proches.map((p) =>
            ocaTexte(
              `${p.intitule}${p.dureeAcquisitionHeures !== null ? ` — ${Math.round(Number(p.dureeAcquisitionHeures))} h d’acquisition` : ''}`,
            ),
          )),
    ),
  );
  contenu.push(espace(REM));

  // ---------- ANNEXES (bannière rouge) — entièrement interne, absente de la version client ----------
  if (inclureInterne) {
    contenu.push(ocaBanniere('ANNEXES (internes)', OCA_ROUGE), espace(REM * 0.4));

    contenu.push(ocaSousTitreRouge('Dossier de référence'));
    contenu.push(ocaBoite(ocaTexte(m.dossierSource?.libelle ?? m.dossierAutre ?? 'XX')));

    contenu.push(ocaSousTitreRouge('Prénom et nom du rédacteur de la fiche'));
    contenu.push(ocaBoite(ocaTexte(m.redacteur ?? 'XX')));

    contenu.push(ocaSousTitreRouge('Informations complémentaires sur le degré d’élargissement du périmètre professionnel'));
    contenu.push(
      ocaTableau([
        new TableRow({
          children: [
            ocaCellule('Indicateurs', { gras: true, couleur: OCA_ROUGE_FONCE }),
            ocaCellule('Valeur prise', { gras: true, couleur: OCA_ROUGE_FONCE }),
          ],
        }),
        new TableRow({
          children: [
            ocaCellule('Prise en charge de responsabilités transversales dans le métier', { couleur: OCA_ROUGE_FONCE }),
            ocaCellule(m.responsTransverse === 'oui' ? 'Oui' : m.responsTransverse === 'non' ? 'Non' : 'Non renseigné', {
              couleur: OCA_ROUGE_FONCE,
            }),
          ],
        }),
        new TableRow({
          children: [
            ocaCellule('Interfaçage nécessaire avec les acteurs de l’organisation (amont / aval)', {
              couleur: OCA_ROUGE_FONCE,
            }),
            ocaCellule(libelleInterfaceOcapiat(m.interfaceAmontAval), { couleur: OCA_ROUGE_FONCE }),
          ],
        }),
      ]),
    );

    if (couples.some((c) => (c.connaissances ?? []).length > 0)) {
      contenu.push(espace(REM * 0.4), ocaSousTitreRouge('Chaînage activité-compétence-connaissance'));
      contenu.push(ocaTableauChainage(couples, connaissances));
    }
  }

  return contenu;
}

export async function exporterFicheMetierOcapiat(params: ExportOcapiatParams): Promise<void> {
  const contenu = await construireContenuOcapiat(params, { inclureInterne: true });
  const [entete, piedDePage] = await Promise.all([enteteOcapiat(), piedDePageOcapiat()]);
  await construireEtTelecharger(contenu, `fiche-metier-ocapiat-${params.metier.codeMetier}.docx`, {
    entete,
    piedDePage,
  });
}

/**
 * Version client : reproduit docs/EXEMPLE FICHE METIER CLIENT.docx — même fiche OCAPIAT,
 * sans la ligne Rédacteur, les encadrés Code famille/Code couple ni la bannière ANNEXES
 * (internes), qui y figurent surlignés en jaune et barrés en rouge, la marque conventionnelle
 * de relecture Word pour « à retirer avant envoi ».
 */
export async function exporterFicheMetierOcapiatClient(params: ExportOcapiatParams): Promise<void> {
  const contenu = await construireContenuOcapiat(params, { inclureInterne: false });
  const [entete, piedDePage] = await Promise.all([enteteOcapiat(), piedDePageOcapiat()]);
  await construireEtTelecharger(contenu, `fiche-metier-ocapiat-client-${params.metier.codeMetier}.docx`, {
    entete,
    piedDePage,
  });
}
