import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../database/connection';

export type OrigineFormacode = 'base_formacodes' | 'base_competences' | 'outil_fiche_metier';

/**
 * Durée d'acquisition d'un formacode à un niveau d'approfondissement donné.
 * `origine` distingue les deux classeurs importés en bloc et les saisies faites
 * directement dans l'outil (`outil_fiche_metier`, prioritaire sur les deux — voir
 * chargerDureesParFormacodeNiveau dans passerelle.service.ts).
 */
export class FormacodeNiveau extends Model<
  InferAttributes<FormacodeNiveau>,
  InferCreationAttributes<FormacodeNiveau>
> {
  declare id: CreationOptional<number>;
  declare codeFormacode: string;
  declare niveau: number;
  declare estNiveauUnique: CreationOptional<boolean>;
  declare dureeHeures: number | null;
  declare dureeSemaines: number | null;
  declare dureeMois: number | null;
  declare methodeCalcul: string | null;
  declare source: string | null;
  declare origine: OrigineFormacode;
  /** `null` sur les lignes antérieures à la migration 012. */
  declare createdAt: CreationOptional<Date | null>;
  declare updatedAt: CreationOptional<Date | null>;
}

FormacodeNiveau.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    codeFormacode: { type: DataTypes.STRING(10), allowNull: false },
    niveau: { type: DataTypes.TINYINT, allowNull: false },
    estNiveauUnique: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    dureeHeures: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    dureeSemaines: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    dureeMois: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    methodeCalcul: { type: DataTypes.TEXT, allowNull: true },
    source: { type: DataTypes.TEXT, allowNull: true },
    origine: {
      type: DataTypes.ENUM('base_formacodes', 'base_competences', 'outil_fiche_metier'),
      allowNull: false,
    },
    createdAt: { type: DataTypes.DATE, allowNull: true },
    updatedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: 'formacode_niveau',
    timestamps: true,
    indexes: [{ unique: true, fields: ['code_formacode', 'niveau', 'origine'] }],
  },
);
