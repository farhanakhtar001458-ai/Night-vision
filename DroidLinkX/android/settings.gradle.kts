pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "DroidLinkX"

include(":app")
include(":core:common")
include(":core:designsystem")
include(":core:domain")
include(":core:database")
include(":core:network")
include(":core:security")
include(":core:data")
include(":feature:dashboard")
include(":feature:devices")
include(":feature:settings")
