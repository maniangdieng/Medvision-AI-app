'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DragEvent, FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { EtatIA } from '@/components/EtatIA';
import { Icone } from '@/components/Icone';
import { useToast } from '@/components/Toasts';
import { Alerte, Bouton, Spinner, Squelette } from '@/components/ui';
import { api, envoyer } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MODALITES, REGIONS, taille } from '@/lib/format';
import type { Patient, Prescripteur } from '@/lib/types';

const ACCEPTE = ['.png', '.jpg', '.jpeg', '.dcm', '.dicom', '.nii', '.nii.gz', '.zip'];
const accepte = (n: string) => ACCEPTE.some((e) => n.toLowerCase().endsWith(e));
const estImage = (f: File) => /\.(png|jpe?g)$/i.test(f.name);

/** Aperçus locaux des PNG/JPG (rien n'est envoyé au serveur pour les afficher) ; null pour DICOM, NIfTI, ZIP. */
function useApercus(fichiers: File[]) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    const u = fichiers.map((f) => (estImage(f) ? URL.createObjectURL(f) : null));
    setUrls(u);
    return () => u.forEach((x) => x && URL.revokeObjectURL(x));
  }, [fichiers]);
  return urls;
}

/** Image en grand dans une fenêtre modale native : Échap ou clic sur le fond pour fermer, flèches pour défiler. */
function Visionneuse({ images, index, choisir }: { images: { url: string; nom: string }[]; index: number | null; choisir: (i: number | null) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (index !== null && d && !d.open) d.showModal();
    if (index === null && d?.open) d.close();
  }, [index]);
  const n = images.length;
  const aller = (pas: number) => index !== null && choisir((index + pas + n) % n);
  const img = index !== null ? images[index] : null;
  return (
    <dialog
      ref={dialog}
      className="visionneuse"
      aria-label="Aperçu de l’image"
      onCancel={(e) => { e.preventDefault(); choisir(null); }}
      onClick={(e) => { if (e.target === dialog.current) choisir(null); }}
      onKeyDown={(e) => { if (n > 1 && e.key === 'ArrowRight') aller(1); if (n > 1 && e.key === 'ArrowLeft') aller(-1); }}
    >
      {img && (
        <>
          <div className="visionneuse-barre">
            <span className="nom-fichier" title={img.nom}>{img.nom}</span>
            {n > 1 && <span className="discret">{index! + 1} / {n}</span>}
            <button type="button" className="btn btn-fantome btn-icone" onClick={() => choisir(null)} aria-label="Fermer l’aperçu" autoFocus><Icone nom="x" /></button>
          </div>
          <img src={img.url} alt={`Aperçu de ${img.nom}`} />
          {n > 1 && (
            <>
              <button type="button" className="visionneuse-nav gauche" onClick={() => aller(-1)} aria-label="Image précédente"><Icone nom="chevron-gauche" taille={22} /></button>
              <button type="button" className="visionneuse-nav droite" onClick={() => aller(1)} aria-label="Image suivante"><Icone nom="chevron-droite" taille={22} /></button>
            </>
          )}
        </>
      )}
    </dialog>
  );
}

function Formulaire() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const radio = user?.role === 'RADIOLOGUE';
  const patientId = useSearchParams().get('patient') || '';
  const [patient, setPatient] = useState<Patient | null>(null);
  // Rien de présélectionné : le type et la région doivent être choisis consciemment pour chaque examen
  const [region, setRegion] = useState('');
  const [modalite, setModalite] = useState('');
  const [indication, setIndication] = useState('');
  const [question, setQuestion] = useState('');
  const [prescripteurs, setPrescripteurs] = useState<Prescripteur[] | null>(null);
  const [prescripteurId, setPrescripteurId] = useState('');
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [survol, setSurvol] = useState(false);
  const [erreur, setErreur] = useState('');
  const [progression, setProgression] = useState<number | null>(null);
  const [vue, setVue] = useState<number | null>(null); // index dans `images` de l'aperçu ouvert en grand
  const input = useRef<HTMLInputElement>(null);
  const urls = useApercus(fichiers);
  const images = fichiers.flatMap((f, i) => (urls[i] ? [{ url: urls[i]!, nom: f.name, i }] : []));

  // Le moteur IA démarre pendant que la fiche est remplie : l'analyse commencera « à chaud »
  useEffect(() => {
    if (!radio) return;
    api('/ai/warmup', { method: 'POST' }).catch(() => {});
    api<Prescripteur[]>('/exams/prescripteurs').then(setPrescripteurs).catch(() => setPrescripteurs([]));
  }, [radio]);

  useEffect(() => {
    if (patientId) api<Patient>(`/patients/${patientId}`).then(setPatient).catch((e) => setErreur(e.message));
  }, [patientId]);

  function ajouter(liste: FileList | null) {
    if (!liste) return;
    const nouveaux = Array.from(liste);
    const refuses = nouveaux.filter((f) => !accepte(f.name));
    setErreur(refuses.length ? `Format non accepté : ${refuses.map((f) => f.name).join(', ')}. Utilisez PNG, JPG, DICOM, NIfTI ou ZIP.` : '');
    setFichiers((av) => [...av, ...nouveaux.filter((f) => accepte(f.name))].slice(0, 20));
  }

  function deposer(e: DragEvent) { e.preventDefault(); setSurvol(false); ajouter(e.dataTransfer.files); }

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    if (!modalite || !region) { setErreur('Choisissez le type d’examen et la région examinée.'); return; }
    if (!prescripteurId) { setErreur('Indiquez le médecin prescripteur : c’est lui qui recevra le compte rendu.'); return; }
    setErreur(''); setProgression(0);
    const fd = new FormData();
    fd.append('patientId', patientId);
    fd.append('region', region);
    fd.append('modalite', modalite);
    fd.append('prescripteurId', prescripteurId);
    if (indication.trim()) fd.append('indication', indication.trim());
    if (question.trim()) fd.append('question', question.trim());
    fichiers.forEach((f) => fd.append('fichiers', f, f.name));
    try {
      const r = await envoyer<{ id: string }>('/exams', fd, setProgression);
      toast('ok', 'Images envoyées. L’IA commence l’analyse.');
      router.replace(`/examens/${r.id}`);
    } catch (err) { setErreur((err as Error).message); setProgression(null); }
  }

  if (user && !radio) {
    return <Alerte genre="info">Seul le radiologue enregistre les examens et dépose les images. Vous recevrez le compte rendu dès qu’il l’aura validé.</Alerte>;
  }

  if (!patientId) {
    return <Alerte genre="info" action={<Link href="/patients" className="btn btn-petit">Choisir un patient</Link>}>Ouvrez d’abord le dossier d’un patient pour lui associer un examen.</Alerte>;
  }

  const envoi = progression !== null;
  const volume = fichiers.reduce((s, f) => s + f.size, 0);

  return (
    <>
      <div className="fil">
        <Link href="/patients">Patients</Link><Icone nom="chevron-droite" taille={14} />
        {patient ? <Link href={`/patients/${patient.id}`}>{patient.nom} {patient.prenom}</Link> : '…'}
        <Icone nom="chevron-droite" taille={14} />Nouvel examen
      </div>
      <div className="entete">
        <div>
          <h1>Nouvel examen</h1>
          <p className="sous">{patient ? `${patient.nom} ${patient.prenom} · dossier ${patient.numeroDossier}` : <Squelette l={240} />}</p>
        </div>
        <EtatIA />
      </div>
      <form onSubmit={soumettre} className="pile" style={{ maxWidth: 820 }}>
        {erreur && <Alerte genre="erreur">{erreur}</Alerte>}

        <section className="panneau">
          <div className="panneau-titre"><h2><span className="etape-num">1</span>Décrivez l’examen</h2></div>
          <div className="panneau-corps pile">
            <div className="champ">
              <label htmlFor="presc">Médecin prescripteur <span className="requis">*</span></label>
              <select id="presc" value={prescripteurId} onChange={(e) => setPrescripteurId(e.target.value)} disabled={!prescripteurs?.length}>
                <option value="">{prescripteurs === null ? 'Chargement…' : prescripteurs.length ? 'Choisir le médecin qui a demandé l’examen' : 'Aucun compte médecin actif'}</option>
                {prescripteurs?.map((m) => <option key={m.id} value={m.id}>Dr {m.nom} {m.prenom}{m.service ? ` · ${m.service}` : ''}</option>)}
              </select>
              <span className="aide">Le compte rendu validé ne sera visible que par ce médecin.</span>
            </div>
            <div className="champ">
              <span className="etiquette">Type d’examen <span className="requis">*</span></span>
              <div className="choix" role="group" aria-label="Type d’examen">
                {MODALITES.map((m) => <button type="button" key={m} aria-pressed={modalite === m} onClick={() => setModalite(m)}>{m}</button>)}
              </div>
            </div>
            <div className="champ">
              <span className="etiquette">Région examinée <span className="requis">*</span></span>
              <div className="choix" role="group" aria-label="Région examinée">
                {REGIONS.map((r) => <button type="button" key={r.valeur} aria-pressed={region === r.valeur} onClick={() => setRegion(r.valeur)}>{r.libelle}</button>)}
              </div>
              <span className="aide">L’IA ne recherche que les anomalies propres à cette région.</span>
            </div>
            <div className="champ">
              <label htmlFor="ind">Indication clinique <span className="facultatif">(recommandé)</span></label>
              <textarea id="ind" rows={2} maxLength={1000} placeholder="Ex. toux fébrile depuis 5 jours, dyspnée" value={indication} onChange={(e) => setIndication(e.target.value)} />
            </div>
            <div className="champ">
              <label htmlFor="q">Question précise pour l’IA <span className="facultatif">(facultatif)</span></label>
              <input id="q" type="text" maxLength={500} placeholder="Ex. y a-t-il un épanchement pleural ?" value={question} onChange={(e) => setQuestion(e.target.value)} />
            </div>
          </div>
        </section>

        <section className="panneau">
          <div className="panneau-titre">
            <h2><span className="etape-num">2</span>Ajoutez les images</h2>
            {fichiers.length > 0 && <span className="badge">{fichiers.length} / 20 · {taille(volume)}</span>}
          </div>
          <div className="panneau-corps">
            <div
              className={`depot${survol ? ' survol' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
              onDragLeave={() => setSurvol(false)}
              onDrop={deposer}
              onClick={() => !envoi && input.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
              role="button" tabIndex={0} aria-label="Ajouter des images"
            >
              <span className="depot-icone"><Icone nom="envoi" taille={28} /></span>
              <strong>{survol ? 'Relâchez pour ajouter les fichiers' : 'Glissez les images ici, ou cliquez pour les choisir'}</strong>
              <span style={{ fontSize: 13 }}>Un dossier compressé en ZIP (export PACS) est aussi accepté. 20 fichiers, 50 Mo chacun au maximum.</span>
              <span className="formats">{['DICOM', 'NIfTI', 'PNG', 'JPG', 'ZIP'].map((f) => <span key={f} className="badge">{f}</span>)}</span>
              <input ref={input} type="file" multiple hidden accept={ACCEPTE.join(',')} onChange={(e) => { ajouter(e.target.files); e.target.value = ''; }} />
            </div>
            {fichiers.length > 0 && (
              <ul className="liste-fichiers">
                {fichiers.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    {urls[i] ? (
                      <button type="button" className="fichier-apercu" onClick={() => setVue(images.findIndex((x) => x.i === i))}
                        aria-label={`Agrandir ${f.name}`} title="Cliquer pour agrandir">
                        <img src={urls[i]!} alt="" />
                        <span className="fichier-loupe"><Icone nom="plein-ecran" taille={16} />Agrandir</span>
                      </button>
                    ) : (
                      <span className="fichier-apercu sans-image">
                        <Icone nom={/\.zip$/i.test(f.name) ? 'archive' : 'fichier'} taille={28} />
                        <span>Aperçu après analyse</span>
                      </span>
                    )}
                    <div className="fichier-pied">
                      <div className="fichier-info"><div className="nom-fichier" title={f.name}>{f.name}</div><div className="discret">{taille(f.size)}</div></div>
                      <button type="button" className="btn btn-fantome btn-petit btn-icone" disabled={envoi} aria-label={`Retirer ${f.name}`}
                        onClick={() => setFichiers(fichiers.filter((_, j) => j !== i))}><Icone nom="x" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Visionneuse images={images} index={vue} choisir={setVue} />
          </div>
        </section>

        <section className="panneau">
          <div className="panneau-titre"><h2><span className="etape-num">3</span>Lancez l’analyse</h2></div>
          <div className="panneau-corps pile">
            {envoi ? (
              <div aria-live="polite">
                <div className="envoi-etat">
                  <span><Spinner />{progression < 1 ? `Envoi des images… ${taille(volume * progression)} sur ${taille(volume)}` : 'Images reçues, création de l’examen…'}</span>
                  <span>{Math.round(progression * 100)} %</span>
                </div>
                <div className="progression" role="progressbar" aria-label="Envoi des images" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progression * 100)}>
                  <span style={{ width: `${Math.max(3, progression * 100)}%` }} />
                </div>
              </div>
            ) : (
              <p className="aide" style={{ fontSize: 14 }}>
                L’IA rédige un pré-rapport, généralement en quelques minutes. Vous pouvez quitter la page pendant l’analyse : le compte rendu apparaîtra dans la liste des examens.
              </p>
            )}
            <div className="ligne">
              <Bouton className="btn btn-principal" icone="etincelle" chargement={envoi} disabled={!fichiers.length || !patient || !modalite || !region || !prescripteurId}>
                {envoi ? 'Envoi en cours…' : !modalite || !region ? 'Choisissez le type d’examen et la région'
                  : !prescripteurId ? 'Choisissez le médecin prescripteur'
                  : !fichiers.length ? 'Ajoutez au moins une image'
                  : `Lancer l’analyse (${fichiers.length} fichier${fichiers.length > 1 ? 's' : ''})`}
              </Bouton>
              {patient && !envoi && <Link href={`/patients/${patient.id}`} className="btn btn-fantome">Annuler</Link>}
            </div>
          </div>
        </section>
      </form>
    </>
  );
}

export default function NouvelExamen() {
  return <Suspense fallback={<div className="chargement"><Spinner taille={24} /></div>}><Formulaire /></Suspense>;
}
