import McpPanel from './McpPanel.jsx';
import Companion from '../desktop/Companion.jsx';

export default function ConnectionsPanel({ account, notify, go }) {
  return <div className="cfg-stack">
    <McpPanel account={account} notify={notify} go={go}/>
    <Companion embedded account={account} notify={notify} go={go}/>
  </div>;
}
