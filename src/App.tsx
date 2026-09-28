import type { ComponentType, SVGProps } from 'react'
import { useOnline } from './app/device'
import { BookIcon, BrandMark, HomeIcon, SettingsIcon, StudyIcon } from './app/icons'
import { href, useLocation, type Location, type Route } from './app/router'
import { UpdateToast } from './app/UpdateToast'
import { Book } from './screens/Book'
import { Home } from './screens/Home'
import { Settings } from './screens/Settings'
import { Study } from './screens/Study'

const NAV: { route: Route; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { route: 'home', label: 'Home', Icon: HomeIcon },
  { route: 'book', label: 'Book', Icon: BookIcon },
  { route: 'study', label: 'Study', Icon: StudyIcon },
  { route: 'settings', label: 'Settings', Icon: SettingsIcon },
]

const SCREENS: Record<Route, ComponentType<{ location: Location }>> = {
  home: Home,
  book: Book,
  study: Study,
  settings: Settings,
}

export function App() {
  const location = useLocation()
  const route = location.name
  const online = useOnline()
  const Screen = SCREENS[route]

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={href('home')}>
          <BrandMark className="brand-mark" />
          Rev Exam
        </a>
        <div className="topbar-status">{!online && <span className="chip chip-offline">Offline</span>}</div>
      </header>

      <nav className="nav" aria-label="Main">
        {NAV.map(({ route: r, label, Icon }) => (
          <a key={r} href={href(r)} aria-current={r === route ? 'page' : undefined}>
            <Icon />
            {label}
          </a>
        ))}
      </nav>

      <main className="main" key={route}>
        <Screen location={location} />
      </main>

      <UpdateToast />
    </div>
  )
}
