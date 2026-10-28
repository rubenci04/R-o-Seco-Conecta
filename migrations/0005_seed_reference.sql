-- Migración 0005: datos de referencia (categorías y fuentes). No contiene publicaciones, horarios, radios ni credenciales.

INSERT INTO categories (id, name, description, sort_order) VALUES
  ('institucional',  'Noticias institucionales', 'Comunicados y novedades de la Comuna', 1),
  ('agua',           'Cortes de agua',           'Interrupciones del suministro de agua', 2),
  ('energia',        'Cortes de energía',        'Interrupciones del servicio eléctrico', 3),
  ('calles',         'Calles cortadas',          'Cortes de calles, rutas y desvíos', 4),
  ('meteorologica',  'Alertas meteorológicas',   'Avisos por clima y fenómenos', 5),
  ('eventos',        'Eventos y festividades',   'Fiestas, actos y celebraciones', 6),
  ('deportes',       'Actividades deportivas',   'Torneos, clubes y competencias', 7),
  ('cultura',        'Cultura',                  'Música, talleres, muestras y tradiciones', 8),
  ('educacion',      'Educación',                'Escuelas, inscripciones y clases', 9),
  ('salud',          'Salud',                    'Campañas, vacunación y atención', 10),
  ('obituarios',     'Obituarios',               'Comunicados fúnebres verificados', 11),
  ('otros',          'Otros avisos comunitarios','Avisos que no encajan en otra categoría', 12);

-- Fuentes oficiales. Quedan DESHABILITADAS y sin configurar: no hay credenciales de Meta.
INSERT INTO sources (id, kind, name, url, mode, enabled, status) VALUES
  ('facebook-comuna',  'facebook',  'Comuna de Río Seco · Facebook',  'https://www.facebook.com/p/Comuna-De-Rio-Seco-61553018412844/', 'manual', 0, 'not-configured'),
  ('instagram-comuna', 'instagram', 'Comuna de Río Seco · Instagram', 'https://www.instagram.com/comunaderioseco/', 'manual', 0, 'not-configured'),
  ('manual',           'manual',    'Redacción Río Seco Conecta',      NULL, 'manual', 1, 'ok');

