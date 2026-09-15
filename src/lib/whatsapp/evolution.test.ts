import { describe, it, expect } from 'vitest';
import { mimeDaUrl, montarEnvio, nomeDoArquivo } from './evolution';

/**
 * Só a parte pura do conector: qual rota da Evolution e qual corpo. É onde mora a
 * regra de negócio (menção a todos, tipo de mídia), e dá para testar sem rede.
 */

describe('montarEnvio — texto', () => {
  it('usa /message/sendText com o número normalizado', () => {
    const r = montarEnvio('inst-1', { destino: '120363-group', tipo: 'texto', texto: 'oi' });
    expect(r.caminho).toBe('/message/sendText/inst-1');
    expect(r.corpo).toMatchObject({ number: '120363@g.us', text: 'oi' });
  });

  it('tipo com mídia mas sem URL cai para texto, em vez de mandar mídia vazia', () => {
    const r = montarEnvio('i', { destino: '1@g.us', tipo: 'imagem', texto: 'oi', midiaUrl: null });
    expect(r.caminho).toContain('sendText');
  });

  it('escapa o nome da instância na rota', () => {
    const r = montarEnvio('inst com espaço', { destino: '1@g.us', tipo: 'texto', texto: 'x' });
    expect(r.caminho).toBe('/message/sendText/inst%20com%20espa%C3%A7o');
  });
});

describe('montarEnvio — menção a todos', () => {
  it('em GRUPO, manda mentionsEveryOne (a Evolution resolve os participantes)', () => {
    // No Z-API isso exigia uma chamada extra de group-metadata e montar a lista à mão.
    const r = montarEnvio('i', {
      destino: '120@g.us',
      tipo: 'texto',
      texto: 'oi',
      mencionarTodos: true,
    });
    expect(r.corpo.mentionsEveryOne).toBe(true);
  });

  it('em CONVERSA INDIVIDUAL, não manda menção — não existe @todos para uma pessoa', () => {
    const r = montarEnvio('i', {
      destino: '5511999998888',
      tipo: 'texto',
      texto: 'oi',
      mencionarTodos: true,
    });
    expect(r.corpo.mentionsEveryOne).toBeUndefined();
  });
});

describe('montarEnvio — mídia', () => {
  it('imagem vai como mediatype image, com a legenda', () => {
    const r = montarEnvio('i', {
      destino: '1@g.us',
      tipo: 'imagem',
      texto: 'legenda',
      midiaUrl: 'https://x.com/foto.jpg',
    });
    expect(r.caminho).toBe('/message/sendMedia/i');
    expect(r.corpo).toMatchObject({
      mediatype: 'image',
      mimetype: 'image/jpeg',
      caption: 'legenda',
    });
  });

  it('vídeo vai como mediatype video', () => {
    const r = montarEnvio('i', {
      destino: '1@g.us',
      tipo: 'video',
      texto: '',
      midiaUrl: 'https://x.com/v.mp4',
    });
    expect(r.corpo).toMatchObject({ mediatype: 'video', mimetype: 'video/mp4' });
  });

  it('PDF vira document COM nome de arquivo — sem ele o WhatsApp mostra "documento"', () => {
    const r = montarEnvio('i', {
      destino: '1@g.us',
      tipo: 'pdf',
      texto: '',
      midiaUrl: 'https://x.com/contrato-2026.pdf',
    });
    expect(r.corpo).toMatchObject({
      mediatype: 'document',
      mimetype: 'application/pdf',
      fileName: 'contrato-2026.pdf',
    });
  });

  it('legenda vazia não vai como string vazia', () => {
    const r = montarEnvio('i', {
      destino: '1@g.us',
      tipo: 'imagem',
      texto: '',
      midiaUrl: 'https://x.com/f.png',
    });
    expect(r.corpo.caption).toBeUndefined();
  });

  it('áudio usa a rota própria', () => {
    const r = montarEnvio('i', {
      destino: '1@g.us',
      tipo: 'audio',
      texto: '',
      midiaUrl: 'https://x.com/a.mp3',
    });
    expect(r.caminho).toBe('/message/sendWhatsAppAudio/i');
  });
});

describe('mimeDaUrl', () => {
  it('deduz pela extensão', () => {
    expect(mimeDaUrl('https://x.com/a.png', 'imagem')).toBe('image/png');
    expect(mimeDaUrl('https://x.com/a.webp', 'imagem')).toBe('image/webp');
  });
  it('ignora query string e âncora', () => {
    expect(mimeDaUrl('https://x.com/a.jpg?token=1#y', 'imagem')).toBe('image/jpeg');
  });
  it('sem extensão, cai no padrão do tipo', () => {
    expect(mimeDaUrl('https://x.com/arquivo', 'imagem')).toBe('image/jpeg');
    expect(mimeDaUrl('https://x.com/arquivo', 'pdf')).toBe('application/pdf');
  });
});

describe('nomeDoArquivo', () => {
  it('pega o último trecho do caminho', () => {
    expect(nomeDoArquivo('https://x.com/pasta/contrato.pdf?v=2')).toBe('contrato.pdf');
  });
  it('sem nome, usa um padrão em vez de string vazia', () => {
    expect(nomeDoArquivo('https://x.com/')).toBe('documento.pdf');
  });
});
