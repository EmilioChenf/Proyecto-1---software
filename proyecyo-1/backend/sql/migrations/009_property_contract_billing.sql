-- Additive, restartable migration. Existing relationships and financial rows remain untouched.
CREATE TABLE IF NOT EXISTS TARIFA_MANTENIMIENTO (
  id_tarifa BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vigente_desde DATE NOT NULL UNIQUE,
  monto DECIMAL(10,2) NOT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_tarifa_monto CHECK (monto >= 0),
  CONSTRAINT chk_tarifa_periodo CHECK (DAY(vigente_desde)=1),
  FOREIGN KEY (creado_por) REFERENCES USUARIO(id_usuario)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS CONTRATO_CASA (
  id_contrato BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_casa INT NOT NULL,
  tipo ENUM('COMPRA_FINANCIADA','RENTA_DIRECTA','PROPIEDAD_PRIVADA') NOT NULL,
  fecha_inicio DATE NOT NULL,
  primer_periodo DATE NOT NULL,
  meses_financiamiento SMALLINT UNSIGNED NULL,
  estado ENUM('VIGENTE','FINANCIAMIENTO_COMPLETADO','CERRADO') NOT NULL DEFAULT 'VIGENTE',
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contrato_casa(id_contrato,id_casa),
  FOREIGN KEY (id_casa) REFERENCES CASA(id_casa),
  FOREIGN KEY (creado_por) REFERENCES USUARIO(id_usuario),
  CONSTRAINT chk_contrato_plazo CHECK ((tipo='COMPRA_FINANCIADA' AND meses_financiamiento BETWEEN 1 AND 1200) OR (tipo<>'COMPRA_FINANCIADA' AND meses_financiamiento IS NULL)),
  CONSTRAINT chk_contrato_periodo CHECK (DAY(primer_periodo)=1)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS CASA_TITULARIDAD (
  id_titularidad BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_casa INT NOT NULL,
  id_usuario INT NULL,
  titular_empresa BOOLEAN NOT NULL,
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_titularidad_vigencia(id_casa,vigente_desde,vigente_hasta),
  FOREIGN KEY (id_casa) REFERENCES CASA(id_casa),
  FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario),
  FOREIGN KEY (creado_por) REFERENCES USUARIO(id_usuario),
  CONSTRAINT chk_titularidad CHECK ((titular_empresa=1 AND id_usuario IS NULL) OR (titular_empresa=0 AND id_usuario IS NOT NULL)),
  CONSTRAINT chk_titularidad_fechas CHECK (vigente_hasta IS NULL OR vigente_hasta>vigente_desde)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS CASA_RESPONSABLE_FINANCIERO (
  id_responsabilidad BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_casa INT NOT NULL,
  id_usuario INT NOT NULL,
  calidad ENUM('COMPRADOR','ARRENDATARIO_DIRECTO','PROPIETARIO') NOT NULL,
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_responsabilidad_casa(id_responsabilidad,id_casa),
  KEY ix_responsable_vigencia(id_casa,vigente_desde,vigente_hasta),
  FOREIGN KEY (id_casa) REFERENCES CASA(id_casa),
  FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario),
  FOREIGN KEY (creado_por) REFERENCES USUARIO(id_usuario),
  CONSTRAINT chk_responsabilidad_fechas CHECK (vigente_hasta IS NULL OR vigente_hasta>vigente_desde)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS CONTRATO_CASA_VERSION (
  id_version BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_contrato BIGINT UNSIGNED NOT NULL,
  id_casa INT NOT NULL,
  id_responsabilidad BIGINT UNSIGNED NOT NULL,
  cuota_vivienda DECIMAL(10,2) NOT NULL DEFAULT 0,
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_version_periodo(id_casa,vigente_desde),
  UNIQUE KEY uq_version_casa(id_version,id_casa),
  FOREIGN KEY (id_contrato,id_casa) REFERENCES CONTRATO_CASA(id_contrato,id_casa),
  FOREIGN KEY (id_responsabilidad,id_casa) REFERENCES CASA_RESPONSABLE_FINANCIERO(id_responsabilidad,id_casa),
  FOREIGN KEY (creado_por) REFERENCES USUARIO(id_usuario),
  CONSTRAINT chk_version_monto CHECK (cuota_vivienda>=0),
  CONSTRAINT chk_version_fechas CHECK (DAY(vigente_desde)=1 AND (vigente_hasta IS NULL OR (DAY(vigente_hasta)=1 AND vigente_hasta>vigente_desde)))
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS CASA_HABITANTE (
  id_habitante BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_casa INT NOT NULL,
  id_usuario INT NOT NULL,
  calidad ENUM('PROPIETARIO','COMPRADOR','ARRENDATARIO_DIRECTO','INQUILINO_PRIVADO') NOT NULL,
  autorizado BOOLEAN NOT NULL DEFAULT 1,
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_habitante_vigencia(id_casa,vigente_desde,vigente_hasta),
  KEY ix_habitante_usuario(id_usuario,vigente_desde,vigente_hasta),
  FOREIGN KEY (id_casa) REFERENCES CASA(id_casa),
  FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario),
  FOREIGN KEY (creado_por) REFERENCES USUARIO(id_usuario),
  CONSTRAINT chk_habitante_fechas CHECK (vigente_hasta IS NULL OR vigente_hasta>vigente_desde)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS FACTURACION_CASA_PERIODO (
  id_casa INT NOT NULL,
  periodo DATE NOT NULL,
  id_version BIGINT UNSIGNED NOT NULL,
  id_tarifa BIGINT UNSIGNED NOT NULL,
  configuracion_snapshot JSON NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id_casa,periodo),
  FOREIGN KEY (id_version,id_casa) REFERENCES CONTRATO_CASA_VERSION(id_version,id_casa),
  FOREIGN KEY (id_tarifa) REFERENCES TARIFA_MANTENIMIENTO(id_tarifa),
  CONSTRAINT chk_facturacion_periodo CHECK (DAY(periodo)=1)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS OPERACION_CONTRACTUAL (
  id_operacion CHAR(36) PRIMARY KEY,
  id_usuario INT NOT NULL,
  id_casa INT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  resultado JSON NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario),
  FOREIGN KEY (id_casa) REFERENCES CASA(id_casa)
) ENGINE=InnoDB;
 -- Existing rows deliberately retain HISTORICO with unknown responsibility.
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CASA' AND COLUMN_NAME='version_contractual')=0,'ALTER TABLE CASA ADD COLUMN version_contractual INT UNSIGNED NOT NULL DEFAULT 0','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CASA' AND COLUMN_NAME='relaciones_confirmadas_en')=0,'ALTER TABLE CASA ADD COLUMN relaciones_confirmadas_en DATETIME NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='SERVICIO' AND COLUMN_NAME='codigo_financiero')=0,'ALTER TABLE SERVICIO ADD COLUMN codigo_financiero VARCHAR(32) NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='origen')=0,'ALTER TABLE CUOTA ADD COLUMN origen ENUM(''HISTORICO'',''MENSUAL'') NOT NULL DEFAULT ''HISTORICO''','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='periodo')=0,'ALTER TABLE CUOTA ADD COLUMN periodo DATE NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='concepto')=0,'ALTER TABLE CUOTA ADD COLUMN concepto ENUM(''VIVIENDA'',''ALQUILER_RESIDENCIAL'',''MANTENIMIENTO'') NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='concepto_snapshot')=0,'ALTER TABLE CUOTA ADD COLUMN concepto_snapshot VARCHAR(100) NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='id_contrato')=0,'ALTER TABLE CUOTA ADD COLUMN id_contrato BIGINT UNSIGNED NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='id_version')=0,'ALTER TABLE CUOTA ADD COLUMN id_version BIGINT UNSIGNED NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='id_responsabilidad')=0,'ALTER TABLE CUOTA ADD COLUMN id_responsabilidad BIGINT UNSIGNED NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='id_responsable')=0,'ALTER TABLE CUOTA ADD COLUMN id_responsable INT NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='responsable_snapshot')=0,'ALTER TABLE CUOTA ADD COLUMN responsable_snapshot JSON NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='numero_cuota')=0,'ALTER TABLE CUOTA ADD COLUMN numero_cuota SMALLINT UNSIGNED NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='creado_en')=0,'ALTER TABLE CUOTA ADD COLUMN creado_en DATETIME NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='PAGO' AND COLUMN_NAME='id_actor')=0,'ALTER TABLE PAGO ADD COLUMN id_actor INT NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='PAGO' AND COLUMN_NAME='titular_snapshot')=0,'ALTER TABLE PAGO ADD COLUMN titular_snapshot JSON NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='SERVICIO' AND INDEX_NAME='uq_servicio_financiero')=0,'ALTER TABLE SERVICIO ADD UNIQUE KEY uq_servicio_financiero(codigo_financiero)','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND INDEX_NAME='uq_cuota_casa_periodo_concepto')=0,'ALTER TABLE CUOTA ADD UNIQUE KEY uq_cuota_casa_periodo_concepto(id_casa,periodo,concepto)','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND INDEX_NAME='uq_cuota_contrato_numero')=0,'ALTER TABLE CUOTA ADD UNIQUE KEY uq_cuota_contrato_numero(id_contrato,numero_cuota)','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND CONSTRAINT_NAME='fk_cuota_contrato')=0,'ALTER TABLE CUOTA ADD CONSTRAINT fk_cuota_contrato FOREIGN KEY(id_contrato,id_casa) REFERENCES CONTRATO_CASA(id_contrato,id_casa)','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND CONSTRAINT_NAME='fk_cuota_version')=0,'ALTER TABLE CUOTA ADD CONSTRAINT fk_cuota_version FOREIGN KEY(id_version,id_casa) REFERENCES CONTRATO_CASA_VERSION(id_version,id_casa)','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND CONSTRAINT_NAME='fk_cuota_responsabilidad')=0,'ALTER TABLE CUOTA ADD CONSTRAINT fk_cuota_responsabilidad FOREIGN KEY(id_responsabilidad,id_casa) REFERENCES CASA_RESPONSABLE_FINANCIERO(id_responsabilidad,id_casa)','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND CONSTRAINT_NAME='fk_cuota_responsable')=0,'ALTER TABLE CUOTA ADD CONSTRAINT fk_cuota_responsable FOREIGN KEY(id_responsable) REFERENCES USUARIO(id_usuario)','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='PAGO' AND CONSTRAINT_NAME='fk_pago_actor')=0,'ALTER TABLE PAGO ADD CONSTRAINT fk_pago_actor FOREIGN KEY(id_actor) REFERENCES USUARIO(id_usuario)','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND CONSTRAINT_NAME='chk_cuota_mensual')=0,'ALTER TABLE CUOTA ADD CONSTRAINT chk_cuota_mensual CHECK(origen=''HISTORICO'' OR (periodo IS NOT NULL AND DAY(periodo)=1 AND concepto IS NOT NULL AND concepto_snapshot IS NOT NULL AND id_contrato IS NOT NULL AND id_version IS NOT NULL AND id_responsabilidad IS NOT NULL AND id_responsable IS NOT NULL AND responsable_snapshot IS NOT NULL AND creado_en IS NOT NULL))','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
-- A company-owned direct rental has no personal owner to impersonate.
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='SOLICITUD_AUTORIZACION_DIGITAL' AND COLUMN_NAME='id_propietario_usuario' AND IS_NULLABLE='NO')>0,'ALTER TABLE SOLICITUD_AUTORIZACION_DIGITAL MODIFY COLUMN id_propietario_usuario INT NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
