import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../database/connection';

/**
 * Table pivot du modèle : les 5 blocs
 * FORMACODE_n / CONN_INT_n / CONN_NIV_n / CONN_DUR_n / CONN_JUSTIF_DUR_n / NSF_n / FONDAMENTAL_n
 * deviennent une ligne chacun.
 *
 * C'est elle qui porte la logique de passerelles : la proximité entre deux métiers se calcule
 * sur les domaines de connaissance partagés par leurs activités. ~5 000 lignes.
 */
export class ActiviteConnaissance extends Model<
  InferAttributes<ActiviteConnaissance>,
  InferCreationAttributes<ActiviteConnaissance>
> {
  declare id: CreationOptional<number>;
  declare metierActiviteId: number;
  declare codeFormacode: string;
  /** CONN_INT_n : libellé contextualisé, en capitales dans la source. */
  declare intitule: string | null;
  declare niveau: number | null;
  declare dureeHeures: number | null;
  declare justificationDuree: string | null;
  declare codeNsf: string | null;
  declare estFondamental: CreationOptional<boolean>;
  declare ordre: number;
  /** `null` sur les lignes antérieures à la migration 012. */
  declare createdAt: CreationOptional<Date | null>;
  declare updatedAt: CreationOptional<Date | null>;
}

ActiviteConnaissance.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    metierActiviteId: { type: DataTypes.INTEGER, allowNull: false },
    codeFormacode: { type: DataTypes.STRING(10), allowNull: false },
    intitule: { type: DataTypes.STRING(255), allowNull: true },
    niveau: { type: DataTypes.TINYINT, allowNull: true },
    dureeHeures: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    justificationDuree: { type: DataTypes.TEXT, allowNull: true },
    codeNsf: { type: DataTypes.STRING(10), allowNull: true },
    estFondamental: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ordre: { type: DataTypes.TINYINT, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: true },
    updatedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: 'activite_connaissance',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['metier_activite_id', 'code_formacode'] },
      { fields: ['code_formacode', 'niveau'] },
    ],
  },
);
