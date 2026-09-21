import { DataTypes, Model, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../database/connection';

/**
 * Référentiel ROME (France Travail), chargé depuis l'arborescence principale :
 * 1 911 fiches avec leur intitulé principal (voir rome.importer.ts).
 *
 * Une fiche métier peut citer un code que le référentiel ne connaît pas : `metiers.importer.ts`
 * le crée alors à la volée, sans libellé. Un tel code se repère à son libellé vide sur la
 * page Codes ROME — c'est ainsi qu'un `I130` tronqué s'était glissé en base.
 */
export class Rome extends Model<InferAttributes<Rome>, InferCreationAttributes<Rome>> {
  declare codeRome: string;
  declare libelle: string | null;
}

Rome.init(
  {
    codeRome: { type: DataTypes.STRING(10), primaryKey: true },
    libelle: { type: DataTypes.STRING(255), allowNull: true },
  },
  { sequelize, tableName: 'rome', timestamps: false },
);
