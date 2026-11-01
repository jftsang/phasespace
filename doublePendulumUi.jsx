import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {P, resample, setCamOn, setParams, setTracers, triggerReset} from './doublePendulum';

function Controls() {
  const [muExp, setMuExp] = useState(0);
  const [lamExp, setLamExp] = useState(0);
  const [eVal, setEVal] = useState(2.5);
  const [tracers, setTracersState] = useState(false);
  const [camOn, setCamOnState] = useState(true);

  const mu = Math.pow(10, muExp);
  const lam = Math.pow(10, lamExp);

  useEffect(() => {
    setParams(mu, lam, eVal);
    triggerReset();
  }, [muExp, lamExp, eVal]);

  useEffect(() => {
    setTracers(tracers);
  }, [tracers]);

  useEffect(() => {
    setCamOn(camOn);
  }, [camOn]);

  return (
    <div
      style={{
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        padding: '10px 12px',
        background: '#000a',
        color: '#ddd',
        font: '12px sans-serif',
        borderRadius: '6px',
        display: 'grid',
        gridTemplateColumns: 'auto 130px 44px',
        gap: '4px 8px',
        alignItems: 'center'
      }}
    >
      <span>m<sub>2</sub>/m<sub>1</sub></span>
      <input type="range" min="-2" max="2" step="0.01" value={muExp}
             onInput={(e) => setMuExp(parseFloat(e.target.value))}/>
      <span>{mu.toFixed(2)}</span>

      <span>l<sub>2</sub>/l<sub>1</sub></span>
      <input type="range" min="-2" max="2" step="0.01" value={lamExp}
             onInput={(e) => setLamExp(parseFloat(e.target.value))}/>
      <span>{lam.toFixed(2)}</span>

      <span>E</span>
      <input type="range" min="0.05" max="3" step="0.01" value={eVal}
             onInput={(e) => setEVal(parseFloat(e.target.value))}/>
      <span>{P.E.toFixed(1)}</span>

      <label style={{gridColumn: '1/4'}}>
        <input type="checkbox" checked={tracers} onChange={(e) => setTracersState(e.target.checked)}/> arrows move
        (tracers)
      </label>

      <label style={{gridColumn: '1/4'}}>
        <input type="checkbox" checked={camOn} onChange={(e) => setCamOnState(e.target.checked)}/> camera moves
      </label>

      <button style={{gridColumn: '1/4'}} onClick={resample}>resample tracers</button>
    </div>
  );
}

const root = document.createElement('div');
document.body.appendChild(root);
render(<Controls/>, root);
