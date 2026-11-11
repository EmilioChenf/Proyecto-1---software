export interface UserTypeOption {
  id: number;
  nombre: string;
  personalizado?: boolean;
  descripcion?: string | null;
  color?: string | null;
}

export interface UserRecord {
  id_usuario: number;
  nombre: string;
  correo: string;
  telefono: string | null;
  id_tipo_usuario: number;
  rol: "admin" | "guardia" | "residente" | "inquilino";
  unidad: string | null;
  id_casa: number | null;
  numero_casa: string | null;
  torre: string | null;
}

export interface UserFormValues {
  nombre: string;
  correo: string;
  password: string;
  telefono: string;
  id_tipo_usuario: string;
  // Vivienda elegida en el mapa (residente/inquilino). El backend la revalida bajo bloqueo.
  id_casa: number | null;
}
