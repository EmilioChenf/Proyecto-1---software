-- Condiciones de pago del contrato (aditiva y re-ejecutable).
-- precio_total/enganche/monto_financiado: compra financiada con cuota calculada.
-- dia_pago: dia del mes en que vencen las cuotas (el dia de la fecha efectiva, maximo 28).
-- INQUILINO_PRIVADO como responsable: el inquilino de un propietario paga el mantenimiento.
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CONTRATO_CASA' AND COLUMN_NAME='precio_total')=0,'ALTER TABLE CONTRATO_CASA ADD COLUMN precio_total DECIMAL(12,2) NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CONTRATO_CASA' AND COLUMN_NAME='enganche')=0,'ALTER TABLE CONTRATO_CASA ADD COLUMN enganche DECIMAL(12,2) NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CONTRATO_CASA' AND COLUMN_NAME='monto_financiado')=0,'ALTER TABLE CONTRATO_CASA ADD COLUMN monto_financiado DECIMAL(12,2) NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CONTRATO_CASA' AND COLUMN_NAME='dia_pago')=0,'ALTER TABLE CONTRATO_CASA ADD COLUMN dia_pago TINYINT UNSIGNED NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CASA_RESPONSABLE_FINANCIERO' AND COLUMN_NAME='calidad' AND COLUMN_TYPE LIKE '%INQUILINO_PRIVADO%')=0,'ALTER TABLE CASA_RESPONSABLE_FINANCIERO MODIFY calidad ENUM(''COMPRADOR'',''ARRENDATARIO_DIRECTO'',''PROPIETARIO'',''INQUILINO_PRIVADO'') NOT NULL','SELECT 1');
PREPARE property_stmt FROM @ddl;
EXECUTE property_stmt;
DEALLOCATE PREPARE property_stmt;
