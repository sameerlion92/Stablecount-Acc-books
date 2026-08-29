import AccBooksApp from "./AccBooksApp";
import {I18nProvider} from "./i18n";
import {redirect} from "next/navigation";
import {getSessionIdentity} from "./lib/auth";

export const dynamic="force-dynamic";
export default async function Home(){if(!await getSessionIdentity())redirect("/login");return <I18nProvider><AccBooksApp/></I18nProvider>}
