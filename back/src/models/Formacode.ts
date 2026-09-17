import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../database/connection';

/** Domaine de connaissance identifié par son code Formacode (référentiel Centre Inffo). */
export class Formacode extends Model<InferAttributes<Formacode>, InferCreationAttributes<Formacode>> {
  declare codeFormacode: string;
  declare intitule: string;
  declare codeNsf: string | null;
  declare estFondamental: CreationOptional<boolean>;
  /** `null` sur les lignes antérieures à la migration 012. */
  declare createdAt: CreationOptional<Date | null>;
  declare updatedAt: CreationOptional<Date | null>;
}

Formacode.init(
  {
    codeFormacode: { type: DataTypes.STRING(10), primaryKey: true },
    intitule: { type: DataTypes.STRING(255), allowNull: false },
    codeNsf: { type: DataTypes.STRING(10), allowNull: true },
    estFondamental: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: { type: DataTypes.DATE, allowNull: true },
    updatedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'formacode', timestamps: true },
);
