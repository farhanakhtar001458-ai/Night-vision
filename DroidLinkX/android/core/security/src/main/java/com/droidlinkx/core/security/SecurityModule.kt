package com.droidlinkx.core.security

import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class SecurityModule {

    @Binds
    @Singleton
    abstract fun bindCredentialVault(impl: EncryptedCredentialVault): CredentialVault

    companion object {
        @Provides
        @Singleton
        fun provideKeystoreCrypto(): KeystoreCrypto = KeystoreCrypto()
    }
}
