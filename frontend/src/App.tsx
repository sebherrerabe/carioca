import { Switch, Route } from "wouter";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Lobby from "./pages/Lobby";
import Game from "./pages/Game";

function App() {
  return (
    <>
      <Switch>
        <Route path="/" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/lobby" component={Lobby} />
        <Route path="/game" component={Game} />
      </Switch>
    </>
  )
}

export default App
