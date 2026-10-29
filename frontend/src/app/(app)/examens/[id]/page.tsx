'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnalyseIA } from '@/components/AnalyseIA';
import { useConfirmation } from '@/components/Confirmation';
import { Icone } from '@/components/Icone';
import { Statut } from '@/components/Statut';
import { useToast } from '@/components/Toasts';
import { Alerte, Bouton, Spinner, Squelette } from '@/components/ui';
import { api, telecharger } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { age, dateHeure, libelleRegion } from '@/lib/format';
import { sections } from '@/lib/sections';
import type { Examen } from '@/lib/types';

function Negatoscope({ examen, analyse }: { examen: Examen; analyse: boolean }) {
  const apercus = (examen.images ?? []).filter((i) => i.apercu);
  const autres = (examen.images ?? []).length - apercus.length;
  const [idx, setIdx] = useState(0);
  const [inverse, setInverse] = useState(false);
  const [lum, setLum] = useState(100);
  const [contraste, setContraste] = useState(100);
  const [chargee, setChargee] = useState<string | null>(null);
  const vue = useRef<HTMLDivElement>(null);
  const courant = apercus[idx];
  const n = apercus.length;

  // ← → pour passer d'une image à l'autre, sauf pendant la saisie
  useEffect(() => {
    if (n < 2) return;
    const f = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowRight') setIdx((i) => (i + 1) % n);
      if (e.key === 'ArrowLeft') setIdx((i) => (i - 1 + n) % n);
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [n]);

  const retouche = inverse || lum !== 100 || contraste !== 100;
  const filtre = `${inverse ? 'invert(1) ' : ''}brightness(${lum}%) contrast(${contraste}%)`;

  return (
    <section className="negatoscope" aria-label="Images de l’examen">
      <div className="negatoscope-vue" ref={vue}>
        {courant ? (
          <>
            {chargee !== courant.id && <span className="negato-charge"><Spinner taille={28} label="Chargement de l’image" /></span>}
            <img
              key={courant.id}
              src={`/api/exams/${examen.id}/images/${courant.id}`}
              alt={`Image ${idx + 1} : ${courant.nomOriginal}`}
              className={chargee === courant.id ? 'chargee' : ''}
              style={{ filter: filtre }}
              onLoad={() => setChargee(courant.id)}
              onError={() => setChargee(courant.id)}
            />
            {n > 1 && <>
              <span className="negato-compte">{idx + 1} / {n}</span>
              <button className="negato-nav g" onClick={() => setIdx((idx - 1 + n) % n)} aria-label="Image précédente"><Icone nom="chevron-gauche" /></button>
              <button className="negato-nav d" onClick={() => setIdx((idx + 1) % n)} aria-label="Image suivante"><Icone nom="chevron-droite" /></button>
            </>}
          </>
        ) : (
          <div className="negato-vide">
            <Icone nom={autres > 0 ? 'archive' : 'image'} taille={36} />
            {autres > 0
              ? `${autres} fichier${autres > 1 ? 's' : ''} DICOM, NIfTI ou ZIP : l’aperçu n’est pas disponible dans le navigateur, mais l’IA les analyse bien.`
              : 'Aucune image.'}
          </div>
        )}
        {analyse && <div className="balayage" aria-hidden="true" />}
      </div>

      {courant && (
        <div className="negatoscope-outils" role="toolbar" aria-label="Réglages d’affichage">
          <label className="curseur" title="Luminosité">
            <Icone nom="soleil" /><span className="sr">Luminosité</span>
            <input type="range" min={40} max={200} value={lum} onChange={(e) => setLum(+e.target.value)} />
          </label>
          <label className="curseur" title="Contraste">
            <Icone nom="contraste" /><span className="sr">Contraste</span>
            <input type="range" min={40} max={250} value={contraste} onChange={(e) => setContraste(+e.target.value)} />
          </label>
          <div className="outils-fin">
            <button className="outil" onClick={() => setInverse(!inverse)} aria-pressed={inverse} title="Inverser les niveaux de gris"><Icone nom="inverser" />Inverser</button>
            {retouche && <button className="outil" onClick={() => { setInverse(false); setLum(100); setContraste(100); }} title="Réinitialiser l’affichage" aria-label="Réinitialiser l’affichage"><Icone nom="reinitialiser" /></button>}
            <button className="outil" onClick={() => vue.current?.requestFullscreen?.()} title="Plein écran" aria-label="Plein écran"><Icone nom="plein-ecran" /></button>
          </div>
        </div>
      )}
      {courant && <div className="negatoscope-barre"><span title={courant.nomOriginal}>{courant.nomOriginal}</span>{n > 1 && <span>← → pour naviguer</span>}</div>}
      {n > 1 && (
        <div className="vignettes">
          {apercus.map((im, i) => (
            <button key={im.id} onClick={() => setIdx(i)} aria-current={i === idx} aria-label={`Afficher l’image ${i + 1}`}>
              <img src={`/api/exams/${examen.id}/images/${im.id}`} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SqueletteExamen() {
  return (
    <div aria-busy="true" aria-label="Chargement de l’examen">
      <Squelette l={180} h={12} />
      <div style={{ margin: '14px 0 26px' }}><Squelette l={340} h={30} /></div>
      <div className="examen">
        <div className="negatoscope" style={{ aspectRatio: '1 / 1', display: 'grid', placeItems: 'center', color: 'var(--lueur)' }}><Spinner taille={28} /></div>
        <div className="panneau panneau-corps pile">
          {[90, 70, 100, 60, 85].map((l, i) => <Squelette key={i} l={`${l}%`} h={i % 2 ? 12 : 16} />)}
        </div>
      </div>
    </div>
  );
}

type Action = 'enregistrer' | 'valider' | 'relancer' | 'arreter' | 'pdf';

export default function PageExamen() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const confirmer = useConfirmation();
  const toast = useToast();
  const [e, setE] = useState<Examen | null>(null);
  const [erreur, setErreur] = useState('');
  const [edition, setEdition] = useState(false);
  const [texte, setTexte] = useState('');
  const [occupe, setOccupe] = useState<Action | null>(null);
  const statutPrecedent = useRef<string | null>(null);

  const charger = useCallback(() => api<Examen>(`/exams/${id}`).then(setE).catch((x) => setErreur(x.message)), [id]);
  useEffect(() => { charger(); }, [charger]);

  const medecin = user?.role === 'MEDECIN';

  // Suivi en direct : pendant l'analyse pour le radiologue, jusqu'à la validation pour le médecin
  useEffect(() => {
    if (!e) return;
    const attente = medecin ? e.statut !== 'VALIDE' : ['EN_ATTENTE', 'ANALYSE_EN_COURS'].includes(e.statut);
    if (!attente) return;
    const t = setInterval(charger, medecin ? 20_000 : 4000);
    return () => clearInterval(t);
  }, [e, charger, medecin]);

  // Prévenir quand le statut change pendant qu'on regarde la page
  useEffect(() => {
    if (!e) return;
    const avant = statutPrecedent.current;
    if (avant && avant !== e.statut) {
      if (medecin) {
        if (e.statut === 'VALIDE') toast('ok', 'Le compte rendu du radiologue est disponible.');
      } else if (['EN_ATTENTE', 'ANALYSE_EN_COURS'].includes(avant)) {
        if (e.statut === 'A_VALIDER') toast('ok', 'Analyse terminée : le compte rendu est prêt.');
        // un arrêt demandé a déjà son propre message : pas de faux « échec »
        if (e.statut === 'ECHEC' && !e.erreur?.startsWith('Analyse arrêtée')) toast('erreur', 'L’analyse a échoué. Vous pouvez la relancer.');
      }
    }
    statutPrecedent.current = e.statut;
  }, [e, toast, medecin]);

  if (erreur && !e) return <Alerte genre="erreur">{erreur}</Alerte>;
  if (!e || !user) return <SqueletteExamen />;

  const radio = user.role === 'RADIOLOGUE';
  const r = e.rapport;
  const modifie = r && r.texteFinal !== r.texteIA;
  const enCours = ['EN_ATTENTE', 'ANALYSE_EN_COURS'].includes(e.statut);

  async function action(nom: Action, fn: () => Promise<unknown>, ok: string) {
    setOccupe(nom); setErreur('');
    try { await fn(); toast('ok', ok); await charger(); } catch (x) { setErreur((x as Error).message); } finally { setOccupe(null); }
  }

  const enregistrer = () => action('enregistrer', async () => {
    await api(`/exams/${id}/rapport`, { method: 'PUT', json: { texteFinal: texte } });
    setEdition(false);
  }, 'Modifications enregistrées.');

  const valider = async () => {
    if (!(await confirmer({
      titre: 'Valider ce compte rendu ?',
      message: 'Il ne pourra plus être modifié et deviendra visible par le médecin prescripteur.',
      confirmer: 'Valider',
    }))) return;
    action('valider', () => api(`/exams/${id}/rapport/valider`, { method: 'POST' }), 'Compte rendu validé et transmis au médecin.');
  };

  const relancer = () => action('relancer', () => api(`/exams/${id}/analyze`, { method: 'POST' }), 'Analyse relancée.');

  const arreter = async () => {
    if (!(await confirmer({
      titre: 'Arrêter l’analyse ?',
      message: 'Le compte rendu en cours de rédaction sera abandonné. Vous pourrez relancer l’analyse ensuite.',
      confirmer: 'Arrêter l’analyse',
      danger: true,
    }))) return;
    action('arreter', () => api(`/exams/${id}/analyze/annuler`, { method: 'POST' }), 'Analyse arrêtée.');
  };

  async function pdf() {
    setOccupe('pdf');
    try { await telecharger(`/exams/${id}/rapport/pdf`, `CR_${e!.patient.numeroDossier}.pdf`); }
    catch (x) { toast('erreur', (x as Error).message); }
    finally { setOccupe(null); }
  }

  async function copier() {
    try { await navigator.clipboard.writeText(r!.texteFinal.replace(/\*+/g, '')); toast('ok', 'Texte du compte rendu copié.'); }
    catch { toast('erreur', 'La copie n’est pas autorisée par le navigateur.'); }
  }

  return (
    <>
      <div className="fil">
        <Link href="/examens">Examens</Link><Icone nom="chevron-droite" taille={14} />
        <Link href={`/patients/${e.patient.id}`}>{e.patient.nom} {e.patient.prenom}</Link>
      </div>
      <div className="entete">
        <div>
          <h1>{e.modalite} · {libelleRegion(e.region).toLowerCase()}</h1>
          <p className="sous">
            {e.patient.nom} {e.patient.prenom}{age(e.patient.dateNaissance) ? `, ${age(e.patient.dateNaissance)}` : ''} · dossier <span className="dossier">{e.patient.numeroDossier}</span>
          </p>
        </div>
        <Statut statut={e.statut} />
      </div>

      {erreur && <div style={{ marginBottom: 16 }}><Alerte genre="erreur">{erreur}</Alerte></div>}

      <div className="examen">
        <Negatoscope examen={e} analyse={enCours && !medecin} />

        <div className="pile">
          {enCours && !medecin && <AnalyseIA statut={e.statut} depuis={e.modifieLe} nbImages={e.images?.length ?? 0} />}
          {enCours && radio && (
            <div className="ligne">
              <Bouton className="btn btn-fantome" icone="x" onClick={arreter} chargement={occupe === 'arreter'} disabled={!!occupe}>Arrêter l’analyse</Bouton>
            </div>
          )}

          {medecin && e.statut !== 'VALIDE' && (
            <Alerte genre="info">
              <strong>Examen en cours d’interprétation au service d’imagerie.</strong> Le compte rendu du radiologue apparaîtra ici dès qu’il l’aura validé. Cette page se met à jour toute seule.
            </Alerte>
          )}

          {(e.indication || e.question) && (
            <div className="panneau panneau-corps pile" style={{ gap: 10 }}>
              {e.indication && <p><strong>Indication :</strong> {e.indication}</p>}
              {e.question && <p><strong>Question posée :</strong> {e.question}</p>}
              <p className="aide">
                Prescrit par {e.demandePar ? `Dr ${e.demandePar.prenom} ${e.demandePar.nom}` : '—'}
                {' · '}images déposées le {dateHeure(e.creeLe)}{e.envoyePar ? ` par Dr ${e.envoyePar.prenom} ${e.envoyePar.nom}` : ''}
              </p>
            </div>
          )}

          {e.statut === 'ECHEC' && radio && (
            <Alerte genre="erreur" action={<Bouton className="btn btn-petit" icone="rafraichir" chargement={occupe === 'relancer'} onClick={relancer}>Relancer</Bouton>}>
              <strong>L’analyse a échoué.</strong> {e.erreur || 'Le serveur IA n’a pas répondu.'}
            </Alerte>
          )}

          {r && (
            <section className="panneau">
              <div className="panneau-titre">
                <h2>Compte rendu {e.statut !== 'VALIDE' && <span className="badge badge-ia"><Icone nom="etincelle" />Proposé par l’IA</span>}</h2>
                <div className="ligne" style={{ gap: 4 }}>
                  {radio && e.statut === 'A_VALIDER' && !edition && (
                    <button className="btn btn-fantome btn-petit" onClick={() => { setTexte(r.texteFinal); setEdition(true); }}><Icone nom="crayon" />Modifier</button>
                  )}
                  {!edition && <button className="btn btn-fantome btn-petit btn-icone" onClick={copier} title="Copier le texte" aria-label="Copier le texte"><Icone nom="copier" /></button>}
                  <Bouton className="btn btn-petit" icone="telecharger" chargement={occupe === 'pdf'} onClick={pdf}>PDF</Bouton>
                </div>
              </div>
              <div className="panneau-corps">
                {edition ? (
                  <div className="pile">
                    <textarea className="cr-editeur" value={texte} onChange={(x) => setTexte(x.target.value)} aria-label="Texte du compte rendu" autoFocus />
                    <p className="aide">Gardez les titres en gras (**OBSERVATIONS** :, **IMPRESSION DIAGNOSTIQUE** :…) pour conserver la mise en page du PDF.</p>
                    <div className="ligne">
                      <Bouton className="btn btn-principal" icone="check" onClick={enregistrer} chargement={occupe === 'enregistrer'} disabled={texte.trim().length < 20}>Enregistrer</Bouton>
                      <button className="btn btn-fantome" onClick={() => setEdition(false)} disabled={!!occupe}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div className="cr">
                    {(() => {
                      const rubriques = sections(r.texteFinal);
                      const contexte = rubriques.filter((s) => !s.numero);
                      return (
                        <>
                          {contexte.length > 0 && (
                            <div className="cr-contexte">
                              {contexte.map((s) => <div key={s.titre}><h3>{s.titre}</h3><p>{s.contenu}</p></div>)}
                            </div>
                          )}
                          {rubriques.filter((s) => s.numero).map((s, i) => (
                            <div key={s.titre} className={`cr-section g-${s.genre}`} style={{ animationDelay: `${i * 0.05}s` }}>
                              <h3>{s.genre === 'conclusion' ? <Icone nom="check-cercle" taille={18} /> : <span className="cr-num">{s.numero}</span>}{s.titre}</h3>
                              <p className={s.contenu ? undefined : 'vide'}>{s.contenu || 'Non renseigné'}</p>
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
              <div className="pied-cr">
                {e.statut === 'VALIDE' && r.validePar
                  ? <span className="valide-par"><Icone nom="bouclier" />Validé par Dr {r.validePar.prenom} {r.validePar.nom} le {dateHeure(r.valideLe)}</span>
                  : <span>{r.nbImagesAnalysees} image{r.nbImagesAnalysees > 1 ? 's' : ''} analysée{r.nbImagesAnalysees > 1 ? 's' : ''}{modifie ? ' · corrigé par le radiologue' : ''}</span>}
                {radio && e.statut === 'A_VALIDER' && !edition && (
                  <div className="ligne">
                    <Bouton className="btn btn-fantome" icone="rafraichir" onClick={relancer} chargement={occupe === 'relancer'} disabled={!!occupe}>Régénérer</Bouton>
                    <Bouton className="btn btn-principal" icone="check-cercle" onClick={valider} chargement={occupe === 'valider'} disabled={!!occupe}>Valider le compte rendu</Bouton>
                  </div>
                )}
              </div>
            </section>
          )}

          {r && e.statut !== 'VALIDE' && (
            <p className="mention-ia"><Icone nom="info" taille={16} />Texte rédigé par une IA : relisez chaque section au regard des images avant de valider.</p>
          )}
        </div>
      </div>
    </>
  );
}
