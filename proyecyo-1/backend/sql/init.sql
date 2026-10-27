CREATE DATABASE IF NOT EXISTS nexus_residencial;
USE nexus_residencial;

DROP TABLE IF EXISTS RECORDATORIO_PAGO;
DROP TABLE IF EXISTS ACCESO_EXCEPCION;
DROP TABLE IF EXISTS COMUNICADO_USUARIO;
DROP TABLE IF EXISTS HISTORIAL_CAMBIO_PROVEEDOR;
DROP TABLE IF EXISTS TIPO_USUARIO_PERMISO;
DROP TABLE IF EXISTS RESERVA;
DROP TABLE IF EXISTS REGISTRO_ACCESO;
DROP TABLE IF EXISTS INTENTO_VALIDACION_QR;
DROP TABLE IF EXISTS ACCESO;
DROP TABLE IF EXISTS VISITANTE;
DROP TABLE IF EXISTS SANCION_HISTORIAL;
DROP TABLE IF EXISTS SANCION;
DROP TABLE IF EXISTS PAGO;
DROP TABLE IF EXISTS CUOTA;
DROP TABLE IF EXISTS CASA_SERVICIO;
DROP TABLE IF EXISTS SERVICIO;
DROP TABLE IF EXISTS INQUILINO_CASA;
DROP TABLE IF EXISTS CASA;
DROP TABLE IF EXISTS INQUILINO;
DROP TABLE IF EXISTS RESIDENTE;
DROP TABLE IF EXISTS TICKET;
DROP TABLE IF EXISTS COMUNICADO;
DROP TABLE IF EXISTS PERMISO;
DROP TABLE IF EXISTS AUDITORIA;
DROP TABLE IF EXISTS PASSWORD_RESET_TOKEN;
DROP TABLE IF EXISTS SESION_ACTIVA;
DROP TABLE IF EXISTS USUARIO;
DROP TABLE IF EXISTS TIPO_USUARIO;
DROP TABLE IF EXISTS AMENIDAD;
DROP TABLE IF EXISTS CONFIGURACION;
DROP TABLE IF EXISTS NOTIFICACION;
DROP TABLE IF EXISTS HISTORIAL_RESTAURACION;
DROP TABLE IF EXISTS SOLICITUD_DEMO;


CREATE TABLE TIPO_USUARIO (
    id_tipo_usuario INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE SOLICITUD_DEMO (
    id_solicitud INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(120) NOT NULL,
    correo VARCHAR(160) NOT NULL,
    telefono VARCHAR(25) NOT NULL,
    residencial VARCHAR(160) NOT NULL,
    cantidad_viviendas INT NOT NULL,
    mensaje VARCHAR(1000),
    estado VARCHAR(20) NOT NULL DEFAULT 'NUEVA',
    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_solicitud_demo_estado_fecha (estado, fecha_creacion),
    INDEX idx_solicitud_demo_correo (correo),
    CHECK (estado IN ('NUEVA', 'CONTACTADA', 'DESCARTADA', 'CONVERTIDA')),
    CHECK (cantidad_viviendas BETWEEN 1 AND 100000)
);

CREATE TABLE PERMISO (
    id_permiso INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(100) NOT NULL
);

CREATE TABLE TIPO_USUARIO_PERMISO (
    id_tipo_usuario INT,
    id_permiso INT,
    PRIMARY KEY (id_tipo_usuario, id_permiso),
    FOREIGN KEY (id_tipo_usuario) REFERENCES TIPO_USUARIO(id_tipo_usuario),
    FOREIGN KEY (id_permiso) REFERENCES PERMISO(id_permiso)
);

CREATE TABLE USUARIO (
    id_usuario INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(100) NOT NULL,
    dpi VARCHAR(20) UNIQUE NOT NULL,
    correo VARCHAR(100) UNIQUE NOT NULL,
    telefono VARCHAR(20),
    password VARCHAR(255) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    id_tipo_usuario INT NOT NULL,
    FOREIGN KEY (id_tipo_usuario) REFERENCES TIPO_USUARIO(id_tipo_usuario)
);

CREATE TABLE SESION_ACTIVA (
    id_sesion CHAR(36) PRIMARY KEY,
    id_usuario INT NOT NULL,
    dispositivo VARCHAR(120) NOT NULL,
    user_agent VARCHAR(500),
    direccion_ip VARCHAR(45),
    creada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultima_actividad_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expira_en DATETIME NOT NULL,
    revocada_en DATETIME NULL,
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario) ON DELETE CASCADE,
    INDEX idx_sesion_usuario_estado (id_usuario, revocada_en, expira_en)
);

CREATE TABLE PASSWORD_RESET_TOKEN (
    id_token BIGINT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    token_hash CHAR(64) UNIQUE NOT NULL,
    solicitado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expira_en DATETIME NOT NULL,
    usado_en DATETIME NULL,
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario) ON DELETE CASCADE,
    INDEX idx_password_reset_usuario_estado (id_usuario, usado_en, expira_en)
);

CREATE TABLE AUDITORIA (
    id_auditoria BIGINT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT NULL,
    accion VARCHAR(80) NOT NULL,
    entidad VARCHAR(80) NOT NULL,
    entidad_id VARCHAR(100) NULL,
    datos_anteriores JSON NULL,
    datos_nuevos JSON NULL,
    direccion_ip VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario) ON DELETE SET NULL,
    INDEX idx_auditoria_usuario_fecha (id_usuario, creado_en),
    INDEX idx_auditoria_accion_fecha (accion, creado_en)
);

CREATE TABLE RESIDENTE (
    id_residente INT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT UNIQUE NOT NULL,
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario)
);

CREATE TABLE INQUILINO (
    id_inquilino INT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT UNIQUE NOT NULL,
    autorizado BOOLEAN,
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario)
);

CREATE TABLE CASA (
    id_casa INT PRIMARY KEY AUTO_INCREMENT,
    numero VARCHAR(10) NOT NULL,
    torre VARCHAR(10),
    id_residente INT NOT NULL,
    FOREIGN KEY (id_residente) REFERENCES RESIDENTE(id_residente)
);

CREATE TABLE INQUILINO_CASA (
    id_inquilino INT,
    id_casa INT,
    PRIMARY KEY (id_inquilino, id_casa),
    FOREIGN KEY (id_inquilino) REFERENCES INQUILINO(id_inquilino),
    FOREIGN KEY (id_casa) REFERENCES CASA(id_casa)
);

CREATE TABLE SERVICIO (
    id_servicio INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(100) NOT NULL,
    tipo_servicio VARCHAR(60) NOT NULL DEFAULT 'General',
    descripcion VARCHAR(200)
);

CREATE TABLE CASA_SERVICIO (
    id_casa INT,
    id_servicio INT,
    fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    estado_validacion VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    PRIMARY KEY (id_casa, id_servicio),
    FOREIGN KEY (id_casa) REFERENCES CASA(id_casa),
    FOREIGN KEY (id_servicio) REFERENCES SERVICIO(id_servicio),
    CHECK (estado_validacion IN ('VALIDADO', 'PENDIENTE'))
);

CREATE TABLE HISTORIAL_CAMBIO_PROVEEDOR (
    id_historial INT PRIMARY KEY AUTO_INCREMENT,
    id_casa INT NOT NULL,
    id_servicio INT NOT NULL,
    accion VARCHAR(40) NOT NULL,
    detalle VARCHAR(255) NOT NULL,
    activo_anterior BOOLEAN NULL,
    activo_nuevo BOOLEAN NULL,
    estado_anterior VARCHAR(20) NULL,
    estado_nuevo VARCHAR(20) NULL,
    realizado_por_usuario INT NOT NULL,
    realizado_por_nombre VARCHAR(100) NOT NULL,
    realizado_por_rol VARCHAR(40) NOT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_casa) REFERENCES CASA(id_casa),
    FOREIGN KEY (id_servicio) REFERENCES SERVICIO(id_servicio),
    FOREIGN KEY (realizado_por_usuario) REFERENCES USUARIO(id_usuario)
);

CREATE TABLE CUOTA (
    id_cuota INT PRIMARY KEY AUTO_INCREMENT,
    id_servicio INT NOT NULL,
    id_casa INT NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    fecha_limite DATE NOT NULL,
    FOREIGN KEY (id_servicio) REFERENCES SERVICIO(id_servicio),
    FOREIGN KEY (id_casa) REFERENCES CASA(id_casa)
);

CREATE TABLE PAGO (
    id_pago INT PRIMARY KEY AUTO_INCREMENT,
    id_cuota INT NOT NULL,
    monto_pagado DECIMAL(10,2) NOT NULL,
    fecha_pago DATE,
    FOREIGN KEY (id_cuota) REFERENCES CUOTA(id_cuota)
);

CREATE TABLE SANCION (
    id_sancion INT PRIMARY KEY AUTO_INCREMENT,
    id_casa INT NOT NULL,
    id_cuota INT NULL,
    codigo_regla VARCHAR(60) NOT NULL,
    motivo VARCHAR(120) NOT NULL,
    detalle VARCHAR(255) NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    generada_automaticamente BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_incumplimiento DATE NOT NULL,
    fecha_generacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por INT NULL,
    FOREIGN KEY (id_casa) REFERENCES CASA(id_casa),
    FOREIGN KEY (id_cuota) REFERENCES CUOTA(id_cuota),
    FOREIGN KEY (creado_por) REFERENCES USUARIO(id_usuario),
    UNIQUE KEY uq_sancion_regla_cuota (codigo_regla, id_cuota),
    INDEX idx_sancion_estado_fecha (estado, fecha_generacion),
    CHECK (estado IN ('PENDIENTE', 'PAGADA', 'ANULADA'))
);

CREATE TABLE SANCION_HISTORIAL (
    id_historial INT PRIMARY KEY AUTO_INCREMENT,
    id_sancion INT NOT NULL,
    accion VARCHAR(40) NOT NULL,
    estado_anterior VARCHAR(20) NULL,
    estado_nuevo VARCHAR(20) NOT NULL,
    detalle VARCHAR(255) NOT NULL,
    realizado_por INT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_sancion) REFERENCES SANCION(id_sancion),
    FOREIGN KEY (realizado_por) REFERENCES USUARIO(id_usuario),
    INDEX idx_sancion_historial_fecha (creado_en),
    CHECK (accion IN ('GENERACION_AUTOMATICA', 'CAMBIO_ESTADO'))
);

CREATE TABLE VISITANTE (
    id_visitante INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(100) NOT NULL,
    dpi VARCHAR(20),
    placa VARCHAR(20),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    INDEX idx_visitante_activo (activo)
);

CREATE TABLE ACCESO (
    id_acceso INT PRIMARY KEY AUTO_INCREMENT,
    id_visitante INT NOT NULL,
    id_casa INT NOT NULL,
    id_usuario_autoriza INT,
    fecha DATE NOT NULL,
    hora_inicio TIME,
    hora_fin TIME,
    tipo_visita VARCHAR(20),
    motivo_servicio VARCHAR(120),
    observaciones VARCHAR(255),
    motivo_excepcion VARCHAR(255),
    token_qr VARCHAR(64) UNIQUE,
    estado_acceso VARCHAR(30) NOT NULL DEFAULT 'AUTORIZADA',
    es_acceso_especial BOOLEAN NOT NULL DEFAULT FALSE,
    fuera_horario BOOLEAN NOT NULL DEFAULT FALSE,
    -- HU-C04: cancelacion y eliminacion logicas; nunca se borran movimientos.
    cancelado_en DATETIME NULL,
    id_usuario_cancela INT NULL,
    eliminado_en DATETIME NULL,
    id_usuario_elimina INT NULL,
    FOREIGN KEY (id_visitante) REFERENCES VISITANTE(id_visitante),
    FOREIGN KEY (id_casa) REFERENCES CASA(id_casa),
    FOREIGN KEY (id_usuario_autoriza) REFERENCES USUARIO(id_usuario),
    CONSTRAINT fk_acceso_usuario_cancela FOREIGN KEY (id_usuario_cancela) REFERENCES USUARIO(id_usuario) ON DELETE SET NULL,
    CONSTRAINT fk_acceso_usuario_elimina FOREIGN KEY (id_usuario_elimina) REFERENCES USUARIO(id_usuario) ON DELETE SET NULL,
    CHECK (tipo_visita IN ('VISITA', 'DELIVERY', 'PROVEEDOR')),
    CHECK (estado_acceso IN ('AUTORIZADA', 'INGRESO_REGISTRADO', 'SALIDA_REGISTRADA', 'CANCELADA', 'PENDIENTE_APROBACION', 'RECHAZADA'))
);

CREATE TABLE REGISTRO_ACCESO (
    id_registro INT PRIMARY KEY AUTO_INCREMENT,
    id_acceso INT UNIQUE NOT NULL,
    hora_ingreso TIME,
    hora_salida TIME,
    id_guardia_ingreso INT NULL,
    id_guardia_salida INT NULL,
    FOREIGN KEY (id_acceso) REFERENCES ACCESO(id_acceso),
    CONSTRAINT fk_registro_acceso_id_guardia_ingreso FOREIGN KEY (id_guardia_ingreso) REFERENCES USUARIO(id_usuario) ON DELETE SET NULL,
    CONSTRAINT fk_registro_acceso_id_guardia_salida FOREIGN KEY (id_guardia_salida) REFERENCES USUARIO(id_usuario) ON DELETE SET NULL
);

CREATE TABLE INTENTO_VALIDACION_QR (
    id_intento BIGINT PRIMARY KEY AUTO_INCREMENT,
    id_acceso INT NULL,
    token_qr VARCHAR(64) NULL,
    id_usuario_guardia INT NULL,
    resultado VARCHAR(30) NOT NULL,
    detalle VARCHAR(255) NOT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_acceso) REFERENCES ACCESO(id_acceso) ON DELETE SET NULL,
    FOREIGN KEY (id_usuario_guardia) REFERENCES USUARIO(id_usuario) ON DELETE SET NULL,
    INDEX idx_intento_qr_fecha (creado_en),
    INDEX idx_intento_qr_acceso (id_acceso),
    CHECK (resultado IN ('VALIDO', 'NO_ENCONTRADO', 'AUN_NO_VIGENTE', 'EXPIRADO', 'REUTILIZADO', 'CANCELADO', 'PENDIENTE_APROBACION', 'INVALIDO'))
);

CREATE TABLE AMENIDAD (
    id_amenidad INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(100) NOT NULL,
    descripcion VARCHAR(200),
    hora_apertura TIME NOT NULL DEFAULT '08:00:00',
    hora_cierre TIME NOT NULL DEFAULT '22:00:00',
    intervalo_minutos INT NOT NULL DEFAULT 60,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE RESERVA (
    id_usuario INT,
    id_amenidad INT,
    fecha DATE,
    hora_inicio TIME,
    hora_fin TIME,
    estado VARCHAR(20) NOT NULL DEFAULT 'CONFIRMADA',
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- HU-C05: autoria de la creacion y de la cancelacion.
    creada_por INT NULL,
    cancelada_por INT NULL,
    cancelada_en DATETIME NULL,
    motivo_cancelacion VARCHAR(255) NULL,
    PRIMARY KEY (id_usuario, id_amenidad, fecha, hora_inicio),
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario),
    FOREIGN KEY (id_amenidad) REFERENCES AMENIDAD(id_amenidad),
    CONSTRAINT fk_reserva_creada_por FOREIGN KEY (creada_por) REFERENCES USUARIO(id_usuario) ON DELETE SET NULL,
    CONSTRAINT fk_reserva_cancelada_por FOREIGN KEY (cancelada_por) REFERENCES USUARIO(id_usuario) ON DELETE SET NULL,
    CHECK (estado IN ('PENDIENTE', 'CONFIRMADA', 'CANCELADA'))
);

CREATE INDEX idx_reserva_amenidad_fecha_horario ON RESERVA (id_amenidad, fecha, hora_inicio, hora_fin);

CREATE TABLE COMUNICADO (
    id_comunicado INT PRIMARY KEY AUTO_INCREMENT,
    titulo VARCHAR(200),
    descripcion TEXT,
    fecha DATE,
    creado_por INT,
    tipo_destinatario VARCHAR(20) NOT NULL DEFAULT 'todos',
    enviado_en DATETIME,
    total_destinatarios INT NOT NULL DEFAULT 0,
    FOREIGN KEY (creado_por) REFERENCES USUARIO(id_usuario)
);

CREATE TABLE COMUNICADO_USUARIO (
    id_comunicado INT,
    id_usuario INT,
    leido BOOLEAN,
    PRIMARY KEY (id_comunicado, id_usuario),
    FOREIGN KEY (id_comunicado) REFERENCES COMUNICADO(id_comunicado),
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario)
);

CREATE TABLE TICKET (
    id_ticket INT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    categoria VARCHAR(50),
    descripcion TEXT,
    prioridad VARCHAR(20),
    estado VARCHAR(20),
    fecha_creacion DATE,
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario)
);

CREATE TABLE CONFIGURACION (
    id_configuracion INT PRIMARY KEY AUTO_INCREMENT,
    clave VARCHAR(100) UNIQUE NOT NULL,
    valor VARCHAR(200)
);

CREATE TABLE ACCESO_EXCEPCION (
    id_excepcion INT PRIMARY KEY AUTO_INCREMENT,
    id_acceso INT NOT NULL,
    aprobado_por INT NOT NULL,
    motivo TEXT,
    hora_solicitada_inicio TIME,
    hora_solicitada_fin TIME,
    accion VARCHAR(20) NOT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_acceso) REFERENCES ACCESO(id_acceso),
    FOREIGN KEY (aprobado_por) REFERENCES USUARIO(id_usuario),
    CHECK (accion IN ('APROBADO', 'RECHAZADO'))
);

CREATE TABLE RECARGO_APLICADO (
    id_recargo INT PRIMARY KEY AUTO_INCREMENT,
    id_cuota INT NOT NULL,
    id_casa INT NOT NULL,
    tipo_regla VARCHAR(20) NOT NULL,
    monto_original DECIMAL(10,2) NOT NULL,
    monto_recargo DECIMAL(10,2) NOT NULL,
    fecha_aplicacion DATE NOT NULL,
    aplicado_por INT NULL,
    UNIQUE KEY uq_recargo_cuota (id_cuota),
    FOREIGN KEY (id_cuota) REFERENCES CUOTA(id_cuota),
    FOREIGN KEY (id_casa) REFERENCES CASA(id_casa)
);

INSERT INTO CONFIGURACION (clave, valor)
VALUES
    ('visitas_hora_apertura', '06:00'),
    ('visitas_hora_cierre', '22:00'),
    ('visitas_duracion_maxima_horas', '4'),
    ('visitas_activo', 'true'),
    ('visitas_dias_habilitados', '[1,2,3,4,5,6,0]'),
    ('residencial_nombre', 'NexusResidencial'),
    ('residencial_direccion', ''),
    ('residencial_correo_contacto', 'administracion@nexusresidencial.local'),
    ('residencial_telefono_contacto', ''),
    ('residencial_zona_horaria', 'America/Guatemala'),
    ('residencial_moneda', 'GTQ');

CREATE TABLE NOTIFICACION (
    id_notificacion INT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    id_acceso INT NULL,
    tipo VARCHAR(50) NOT NULL DEFAULT 'LLEGADA_VISITA',
    titulo VARCHAR(150) NOT NULL,
    mensaje VARCHAR(255) NOT NULL,
    leido BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    leido_en DATETIME NULL,
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario),
    FOREIGN KEY (id_acceso) REFERENCES ACCESO(id_acceso) ON DELETE SET NULL
);

CREATE INDEX idx_notificacion_usuario_leido 
ON NOTIFICACION (id_usuario, leido, creado_en);

CREATE TABLE HISTORIAL_RESTAURACION (
    id_restauracion INT PRIMARY KEY AUTO_INCREMENT,
    nombre_archivo VARCHAR(180) NOT NULL,
    estado VARCHAR(20) NOT NULL,
    total_sentencias INT NOT NULL DEFAULT 0,
    tablas_afectadas VARCHAR(500),
    mensaje VARCHAR(255) NOT NULL,
    realizado_por INT NOT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalizado_en DATETIME
);

CREATE TABLE RECORDATORIO_PAGO (
    id_recordatorio INT PRIMARY KEY AUTO_INCREMENT,
    id_casa INT NOT NULL,
    id_cuota INT NOT NULL,
    id_usuario INT NOT NULL,
    id_notificacion INT NULL,
    tipo VARCHAR(30) NOT NULL,
    titulo VARCHAR(150) NOT NULL,
    mensaje VARCHAR(255) NOT NULL,
    monto DECIMAL(10,2) NOT NULL DEFAULT 0,
    fecha_limite DATE NOT NULL,
    dias_para_vencer INT NOT NULL DEFAULT 0,
    fecha_envio DATE NOT NULL,
    enviado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_casa) REFERENCES CASA(id_casa),
    FOREIGN KEY (id_cuota) REFERENCES CUOTA(id_cuota),
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario),
    FOREIGN KEY (id_notificacion) REFERENCES NOTIFICACION(id_notificacion),
    UNIQUE KEY uq_recordatorio_cuota_usuario_tipo_dia (id_cuota, id_usuario, tipo, fecha_envio),
    CHECK (tipo IN ('PROXIMO_VENCIMIENTO', 'VENCIDO'))
);

CREATE INDEX idx_recordatorio_envio
ON RECORDATORIO_PAGO (enviado_en);

CREATE TABLE RECORDATORIO_RESERVA (
    id_recordatorio INT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    id_amenidad INT NOT NULL,
    id_notificacion INT NULL,
    fecha DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    fecha_envio DATE NOT NULL,
    enviado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario),
    FOREIGN KEY (id_amenidad) REFERENCES AMENIDAD(id_amenidad),
    FOREIGN KEY (id_notificacion) REFERENCES NOTIFICACION(id_notificacion),
    UNIQUE KEY uq_recordatorio_reserva_usuario_horario (id_usuario, id_amenidad, fecha, hora_inicio)
);

CREATE TABLE TRANSACCION_SIMULADA (
    id_transaccion INT PRIMARY KEY AUTO_INCREMENT,
    id_pago INT NOT NULL,
    id_usuario INT NOT NULL,
    id_casa INT NOT NULL,
    rol VARCHAR(20) NOT NULL,
    concepto VARCHAR(100) NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'APROBADA',
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_pago) REFERENCES PAGO(id_pago),
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario),
    FOREIGN KEY (id_casa) REFERENCES CASA(id_casa),
    UNIQUE KEY uq_transaccion_simulada_pago (id_pago)
);

INSERT INTO CONFIGURACION (clave, valor)
VALUES
    ('horario_visita_inicio', '06:00'),
    ('horario_visita_fin', '22:00'),
    ('recordatorios_activo', 'true'),
    ('recordatorios_dias_antes', '3');

INSERT INTO TIPO_USUARIO (nombre)
VALUES ('admin'), ('guardia'), ('residente'), ('inquilino');

INSERT INTO PERMISO (nombre)
VALUES
    ('dashboard.admin'),
    ('dashboard.guardia'),
    ('dashboard.residente'),
    ('dashboard.inquilino'),
    ('login.sistema');

INSERT INTO TIPO_USUARIO_PERMISO (id_tipo_usuario, id_permiso)
SELECT tu.id_tipo_usuario, p.id_permiso
FROM TIPO_USUARIO tu
JOIN PERMISO p
WHERE
    (tu.nombre = 'admin' AND p.nombre IN ('dashboard.admin', 'login.sistema')) OR
    (tu.nombre = 'guardia' AND p.nombre IN ('dashboard.guardia', 'login.sistema')) OR
    (tu.nombre = 'residente' AND p.nombre IN ('dashboard.residente', 'login.sistema')) OR
    (tu.nombre = 'inquilino' AND p.nombre IN ('dashboard.inquilino', 'login.sistema'));

INSERT INTO USUARIO (nombre, dpi, correo, telefono, password, activo, id_tipo_usuario)
VALUES
    ('Administrador General', '1000000000001', 'admin@test.com', '5555-0001', '1234', TRUE, (SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre = 'admin')),
    ('Guardia Principal', '1000000000002', 'guardia@test.com', '5555-0002', '1234', TRUE, (SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre = 'guardia')),
    ('Residente Demo', '1000000000003', 'residente@test.com', '5555-0003', '1234', TRUE, (SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre = 'residente')),
    ('Inquilino Demo', '1000000000004', 'inquilino@test.com', '5555-0004', '1234', TRUE, (SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre = 'inquilino'));

INSERT INTO RESIDENTE (id_usuario)
SELECT id_usuario
FROM USUARIO
WHERE correo = 'residente@test.com';

INSERT INTO INQUILINO (id_usuario, autorizado)
SELECT id_usuario, TRUE
FROM USUARIO
WHERE correo = 'inquilino@test.com';

INSERT INTO CASA (numero, torre, id_residente)
VALUES (
    '302',
    'B',
    (SELECT id_residente FROM RESIDENTE WHERE id_usuario = (SELECT id_usuario FROM USUARIO WHERE correo = 'residente@test.com'))
);

INSERT INTO INQUILINO_CASA (id_inquilino, id_casa)
VALUES (
    (SELECT id_inquilino FROM INQUILINO WHERE id_usuario = (SELECT id_usuario FROM USUARIO WHERE correo = 'inquilino@test.com')),
    (SELECT id_casa FROM CASA WHERE numero = '302' AND torre = 'B')
);

INSERT INTO SERVICIO (nombre, tipo_servicio, descripcion)
VALUES
    ('Energia electrica', 'Basico', 'Suministro electrico asociado a la unidad residencial.'),
    ('Agua potable', 'Basico', 'Servicio de agua potable y control de consumo mensual.'),
    ('Internet residencial', 'Telecomunicaciones', 'Proveedor de conectividad para la vivienda.'),
    ('Limpieza y mantenimiento', 'Mantenimiento', 'Servicio programado de limpieza para areas de apoyo.'),
    ('Seguridad privada', 'Seguridad', 'Servicio adicional de control y monitoreo residencial.'),
    ('Alquiler residencial', 'Alquiler', 'Cuota mensual de alquiler asociada al inquilino.');

INSERT INTO CASA_SERVICIO (id_casa, id_servicio, activo, estado_validacion)
SELECT
    (SELECT id_casa FROM CASA WHERE numero = '302' AND torre = 'B'),
    id_servicio,
    TRUE,
    'VALIDADO'
FROM SERVICIO
WHERE nombre IN ('Energia electrica', 'Agua potable', 'Seguridad privada');

INSERT INTO CASA_SERVICIO (id_casa, id_servicio, activo, estado_validacion)
SELECT
    (SELECT id_casa FROM CASA WHERE numero = '302' AND torre = 'B'),
    id_servicio,
    TRUE,
    'VALIDADO'
FROM SERVICIO
WHERE nombre = 'Alquiler residencial';

INSERT INTO HISTORIAL_CAMBIO_PROVEEDOR (
    id_casa,
    id_servicio,
    accion,
    detalle,
    activo_anterior,
    activo_nuevo,
    estado_anterior,
    estado_nuevo,
    realizado_por_usuario,
    realizado_por_nombre,
    realizado_por_rol
)
SELECT
    cs.id_casa,
    cs.id_servicio,
    'CREACION',
    CONCAT('Proveedor inicial asociado a la unidad ', c.torre, '-', c.numero, '.'),
    NULL,
    cs.activo,
    NULL,
    cs.estado_validacion,
    u.id_usuario,
    u.nombre,
    'residente'
FROM CASA_SERVICIO cs
INNER JOIN CASA c
    ON c.id_casa = cs.id_casa
INNER JOIN RESIDENTE r
    ON r.id_residente = c.id_residente
INNER JOIN USUARIO u
    ON u.id_usuario = r.id_usuario
WHERE c.numero = '302' AND c.torre = 'B';

INSERT INTO CUOTA (id_servicio, id_casa, monto, fecha_limite)
VALUES
    (
        (SELECT id_servicio FROM SERVICIO WHERE nombre = 'Agua potable'),
        (SELECT id_casa FROM CASA WHERE numero = '302' AND torre = 'B'),
        350.00,
        DATE_SUB(CURDATE(), INTERVAL 12 DAY)
    ),
    (
        (SELECT id_servicio FROM SERVICIO WHERE nombre = 'Seguridad privada'),
        (SELECT id_casa FROM CASA WHERE numero = '302' AND torre = 'B'),
        500.00,
        DATE_SUB(CURDATE(), INTERVAL 5 DAY)
    ),
    (
        (SELECT id_servicio FROM SERVICIO WHERE nombre = 'Energia electrica'),
        (SELECT id_casa FROM CASA WHERE numero = '302' AND torre = 'B'),
        275.00,
        DATE_ADD(CURDATE(), INTERVAL 8 DAY)
    ),
    (
        (SELECT id_servicio FROM SERVICIO WHERE nombre = 'Alquiler residencial'),
        (SELECT id_casa FROM CASA WHERE numero = '302' AND torre = 'B'),
        2200.00,
        LAST_DAY(CURDATE())
    );

INSERT INTO PAGO (id_cuota, monto_pagado, fecha_pago)
SELECT id_cuota, monto, DATE_SUB(CURDATE(), INTERVAL 2 DAY)
FROM CUOTA
WHERE monto = 500.00
LIMIT 1;

INSERT INTO VISITANTE (nombre, dpi, placa)
VALUES
    ('Juan Perez', '1234567890123', 'P-456DEF'),
    ('Ana Lopez', '9876543210987', 'P-789GHI'),
    ('Maria Garcia', '2345678901234', 'P-123ABC');

INSERT INTO ACCESO (id_visitante, id_casa, fecha, hora_inicio, hora_fin, tipo_visita, token_qr, estado_acceso)
VALUES
    (
        (SELECT id_visitante FROM VISITANTE WHERE dpi = '1234567890123' LIMIT 1),
        (SELECT id_casa FROM CASA WHERE numero = '302' AND torre = 'B'),
        CURDATE(),
        '10:00:00',
        '12:00:00',
        'VISITA',
        'demoqrjuanperez001',
        'AUTORIZADA'
    ),
    (
        (SELECT id_visitante FROM VISITANTE WHERE dpi = '9876543210987' LIMIT 1),
        (SELECT id_casa FROM CASA WHERE numero = '302' AND torre = 'B'),
        CURDATE(),
        '14:00:00',
        '16:00:00',
        'VISITA',
        'demoqranalopez002',
        'AUTORIZADA'
    ),
    (
        (SELECT id_visitante FROM VISITANTE WHERE dpi = '2345678901234' LIMIT 1),
        (SELECT id_casa FROM CASA WHERE numero = '302' AND torre = 'B'),
        DATE_ADD(CURDATE(), INTERVAL 1 DAY),
        '09:00:00',
        '11:00:00',
        'PROVEEDOR',
        'demoqrmariagarcia003',
        'AUTORIZADA'
    );

INSERT INTO AMENIDAD (nombre, descripcion, hora_apertura, hora_cierre, intervalo_minutos, activo)
VALUES
    ('Salon de eventos', 'Espacio para celebraciones privadas y reuniones.', '08:00:00', '22:00:00', 60, TRUE),
    ('Cancha de tenis', 'Cancha al aire libre para entrenamientos y partidos.', '06:00:00', '21:00:00', 60, TRUE),
    ('Piscina', 'Piscina familiar con control por bloques de uso.', '08:00:00', '20:00:00', 60, TRUE),
    ('Gimnasio', 'Zona de entrenamiento con acceso por franjas horarias.', '05:00:00', '22:00:00', 60, TRUE),
    ('Area de parrillas', 'Area social con estaciones de parrilla y mesas.', '09:00:00', '23:00:00', 60, TRUE),
    ('Salon infantil', 'Salon recreativo para actividades infantiles.', '09:00:00', '19:00:00', 60, TRUE);

INSERT INTO RESERVA (id_usuario, id_amenidad, fecha, hora_inicio, hora_fin, estado, creado_en)
VALUES
    (
        (SELECT id_usuario FROM USUARIO WHERE correo = 'residente@test.com'),
        (SELECT id_amenidad FROM AMENIDAD WHERE nombre = 'Salon de eventos'),
        CURDATE(),
        '18:00:00',
        '22:00:00',
        'CONFIRMADA',
        NOW()
    ),
    (
        (SELECT id_usuario FROM USUARIO WHERE correo = 'inquilino@test.com'),
        (SELECT id_amenidad FROM AMENIDAD WHERE nombre = 'Cancha de tenis'),
        CURDATE(),
        '16:00:00',
        '18:00:00',
        'CONFIRMADA',
        NOW()
    ),
    (
        (SELECT id_usuario FROM USUARIO WHERE correo = 'residente@test.com'),
        (SELECT id_amenidad FROM AMENIDAD WHERE nombre = 'Piscina'),
        DATE_ADD(CURDATE(), INTERVAL 1 DAY),
        '14:00:00',
        '16:00:00',
        'CONFIRMADA',
        NOW()
    ),
    (
        (SELECT id_usuario FROM USUARIO WHERE correo = 'inquilino@test.com'),
        (SELECT id_amenidad FROM AMENIDAD WHERE nombre = 'Gimnasio'),
        DATE_ADD(CURDATE(), INTERVAL 2 DAY),
        '07:00:00',
        '08:00:00',
        'PENDIENTE',
        NOW()
    ),
    (
        (SELECT id_usuario FROM USUARIO WHERE correo = 'residente@test.com'),
        (SELECT id_amenidad FROM AMENIDAD WHERE nombre = 'Area de parrillas'),
        DATE_ADD(CURDATE(), INTERVAL 3 DAY),
        '19:00:00',
        '22:00:00',
        'CONFIRMADA',
        NOW()
    ),
    (
        (SELECT id_usuario FROM USUARIO WHERE correo = 'inquilino@test.com'),
        (SELECT id_amenidad FROM AMENIDAD WHERE nombre = 'Salon infantil'),
        DATE_ADD(CURDATE(), INTERVAL 4 DAY),
        '10:00:00',
        '12:00:00',
        'CONFIRMADA',
        NOW()
    ),
    (
        (SELECT id_usuario FROM USUARIO WHERE correo = 'residente@test.com'),
        (SELECT id_amenidad FROM AMENIDAD WHERE nombre = 'Cancha de tenis'),
        DATE_SUB(CURDATE(), INTERVAL 5 DAY),
        '16:00:00',
        '18:00:00',
        'CONFIRMADA',
        NOW()
    ),
    (
        (SELECT id_usuario FROM USUARIO WHERE correo = 'inquilino@test.com'),
        (SELECT id_amenidad FROM AMENIDAD WHERE nombre = 'Piscina'),
        DATE_SUB(CURDATE(), INTERVAL 3 DAY),
        '13:00:00',
        '15:00:00',
        'CONFIRMADA',
        NOW()
    );
