import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../database/connection';

/**
 * Le couple activité-compétence tel qu'il figure sur la fiche métier, issu des 6 blocs
 * de `Outil_collecte_fiche_metier` (30 colonnes chacun, à partir de l'index 46).
 *
 * Les intitulés sont portés ici et non par `activite` : 121 codes activité sont rédigés
 * différemment selon le métier qui les emploie (docs/SCHEMA.md §4). La clé technique `id`
 * sert de point d'accroche aux détails, mots-clés et niveaux de maîtrise.
 */
export class MetierActivite extends Model<
  InferAttributes<MetierActivite>,
  InferCreationAttributes<MetierActivite>
> {
  declare id: CreationOptional<number>;
  declare codeMetier: string;
  declare codeActivite: string;
  declare ordre: number;
  declare intituleActivite: string | null;
  declare intituleCompetence: string | null;
  /**
   * `null` sur les lignes antérieures à la migration 012 : on ne les date pas
   * rétroactivement. Fait foi pour la rédaction entière du couple — les détails et
   * niveaux de maîtrise n'ont pas d'horodatage propre, ils sont réécrits avec lui.
   */
  declare createdAt: CreationOptional<Date | null>;
  declare updatedAt: CreationOptional<Date | null>;
}

MetierActivite.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    codeMetier: { type: DataTypes.STRING(10), allowNull: false },
    codeActivite: { type: DataTypes.STRING(20), allowNull: false },
    ordre: { type: DataTypes.TINYINT, allowNull: false },
    intituleActivite: { type: DataTypes.TEXT, allowNull: true },
    intituleCompetence: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: true },
    updatedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: 'metier_activite',
    timestamps: true,
    indexes: [
      // Le couple est identifié par sa position sur la fiche : le code activité peut
      // être répété au sein d'un métier (erreur de codage sur P285, migration 007).
      { unique: true, fields: ['code_metier', 'ordre'] },
      { fields: ['code_metier', 'code_activite'] },
      // Sens inverse : « quels métiers portent cette activité ? »
      { fields: ['code_activite'] },
    ],
  },
);
